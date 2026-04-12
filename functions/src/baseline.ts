import {
  INSTALL_PLACES,
  callApi,
  clearCollection,
  computeFacilityHash,
  db,
  normalizeFacility,
  nowIso,
  upsertFacilitiesWithDiff,
  type JobDoc,
  type NormalizedFacility,
} from './shared.js';
import { BASELINE_META_KEY, upsertBaselineMeta } from './lib/firestore-repo.js';

export async function processBaselineStep(job: JobDoc, serviceKey: string) {
  const cursor = job.cursor ?? {};
  const stage = cursor.stage ?? 'pfc3';
  const metaDoc = await db.collection('cacheMeta').doc(BASELINE_META_KEY).get();
  const baselineMeta = (metaDoc.data() ?? {}) as Record<string, unknown>;

  if (!cursor.initialized) {
    if (baselineMeta.baselineBuildMode === 'force-rebuild') {
      await clearCollection('facilities');
      await clearCollection('sigunguIndex');
    }
    await db.collection('jobs').doc(job.jobId).set({ cursor: { ...cursor, initialized: true, stage: 'pfc3', page: 1, installPlaceIndex: 0 } }, { merge: true });
    return;
  }

  if (stage === 'pfc3') {
    const installPlaceIndex = cursor.installPlaceIndex ?? 0;
    const page = cursor.page ?? 1;
    const installPlace = INSTALL_PLACES[installPlaceIndex];

    if (!installPlace) {
      await db.collection('jobs').doc(job.jobId).set({
        currentStage: 'exfc5',
        currentInstallPlace: null,
        currentPage: 1,
        cursor: { ...cursor, stage: 'exfc5', excellentPage: 1 },
        updatedAt: nowIso(),
      }, { merge: true });
      return;
    }

    const fetched = await callApi('/pfc3/getPfctInfo3', {
      inslPlcSeCd: installPlace,
      pageIndex: page,
      recordCountPerPage: 200,
      pageNo: page,
      numOfRows: 200,
    }, serviceKey);

    const normalized = fetched.list
      .map((r) => normalizeFacility(r, false))
      .filter((doc): doc is NormalizedFacility => doc !== null);

    const writeResult = await upsertFacilitiesWithDiff(normalized);
    const reachedEnd = fetched.totalPages ? page >= fetched.totalPages : fetched.list.length < 200;
    const now = nowIso();

    await db.collection('jobs').doc(job.jobId).set({
      status: 'running',
      currentStage: 'pfc3',
      currentInstallPlace: installPlace,
      currentPage: page,
      totalPages: fetched.totalPages,
      pagesFetched: (job.pagesFetched ?? 0) + 1,
      rawFacilityCount: (job.rawFacilityCount ?? 0) + fetched.list.length,
      filteredFacilityCount: (job.filteredFacilityCount ?? 0) + normalized.length,
      successCount: (job.successCount ?? 0) + writeResult.writes,
      cursor: {
        ...cursor,
        stage: 'pfc3',
        installPlaceIndex: reachedEnd ? installPlaceIndex + 1 : installPlaceIndex,
        page: reachedEnd ? 1 : page + 1,
        initialized: true,
      },
      updatedAt: now,
      resultSummary: {
        ...(job.resultSummary ?? {}),
        skippedUnchangedCount: Number((job.resultSummary as Record<string, unknown> | undefined)?.skippedUnchangedCount ?? 0) + writeResult.skipped,
      },
    }, { merge: true });

    await upsertBaselineMeta({
      status: 'running',
      baselineStatus: 'running',
      baselineReady: false,
      baselineSource: 'api-crawl',
      baselineCurrentStage: 'pfc3',
      baselineCurrentInstallPlace: installPlace,
      baselineCurrentPage: page,
      baselineTotalPages: fetched.totalPages,
      baselinePagesFetched: (job.pagesFetched ?? 0) + 1,
      baselineRawFacilityCount: (job.rawFacilityCount ?? 0) + fetched.list.length,
      baselineFilteredFacilityCount: (job.filteredFacilityCount ?? 0) + normalized.length,
      baselineUpdatedAt: now,
      updatedAt: now,
      lastBuildStatus: 'ok',
      done: false,
    });
    return;
  }

  if (stage === 'exfc5') {
    const excellentPage = cursor.excellentPage ?? 1;
    const fetched = await callApi('/exfc5/getExfcInfo5', {
      pageIndex: excellentPage,
      recordCountPerPage: 200,
      pageNo: excellentPage,
      numOfRows: 200,
    }, serviceKey);

    const existing = new Set<number>(cursor.excellent ?? []);
    fetched.list.forEach((row) => {
      const n = Number(row.pfctSn);
      if (Number.isFinite(n)) existing.add(n);
    });
    const reachedEnd = fetched.totalPages ? excellentPage >= fetched.totalPages : fetched.list.length < 200;
    const now = nowIso();

    await db.collection('jobs').doc(job.jobId).set({
      status: 'running',
      currentStage: 'exfc5',
      currentPage: excellentPage,
      totalPages: fetched.totalPages,
      pagesFetched: (job.pagesFetched ?? 0) + 1,
      cursor: {
        ...cursor,
        stage: reachedEnd ? 'finalize' : 'exfc5',
        excellentPage: reachedEnd ? 1 : excellentPage + 1,
        excellent: [...existing],
        initialized: true,
      },
      updatedAt: now,
    }, { merge: true });

    await upsertBaselineMeta({
      status: 'running',
      baselineStatus: 'running',
      baselineReady: false,
      baselineCurrentStage: 'exfc5',
      baselineCurrentInstallPlace: null,
      baselineCurrentPage: excellentPage,
      baselineTotalPages: fetched.totalPages,
      baselinePagesFetched: (job.pagesFetched ?? 0) + 1,
      baselineUpdatedAt: now,
      updatedAt: now,
      done: false,
    });
    return;
  }

  const excellentSet = new Set<number>(cursor.excellent ?? []);
  const facilitiesSnap = await db.collection('facilities').get();
  const sigunguMap = new Map<string, Set<string>>();

  const writer = db.bulkWriter();
  let updatedExcellent = 0;
  facilitiesSnap.docs.forEach((doc) => {
    const data = doc.data();
    const shouldExcellent = excellentSet.has(Number(data.pfctSn));
    if (shouldExcellent && !data.isExcellent) {
      const patched = { ...data, isExcellent: true, updatedAt: nowIso() } as Record<string, unknown>;
      patched.contentHash = computeFacilityHash(patched);
      writer.set(doc.ref, patched, { merge: true });
      updatedExcellent += 1;
    }

    if (data.sido) {
      if (!sigunguMap.has(data.sido as string)) sigunguMap.set(data.sido as string, new Set());
      if (data.sigungu) sigunguMap.get(data.sido as string)?.add(String(data.sigungu));
    }
  });
  await writer.close();

  const sigunguWriter = db.bulkWriter();
  for (const [sido, sigunguSet] of sigunguMap.entries()) {
    sigunguWriter.set(db.collection('sigunguIndex').doc(sido), {
      sido,
      sigungu: [...sigunguSet].sort(),
      updatedAt: nowIso(),
    }, { merge: true });
  }
  await sigunguWriter.close();

  const finishedAt = nowIso();
  await upsertBaselineMeta({
    status: 'success',
    baselineStatus: 'success',
    baselineReady: true,
    baselineSource: 'api-crawl',
    baselineCurrentStage: 'completed',
    baselineCurrentInstallPlace: null,
    baselineCurrentPage: 1,
    baselineUpdatedAt: finishedAt,
    facilitiesCount: facilitiesSnap.size,
    excellentCount: updatedExcellent,
    done: true,
    lastBuildStatus: 'ok',
    lastBuiltAt: finishedAt,
    lastSuccessfulBaselineAt: finishedAt,
    baselineVersion: baselineMeta.baselineVersion ?? finishedAt,
    updatedAt: finishedAt,
    lastError: null,
    baselineLastError: null,
  });

  await db.collection('jobs').doc(job.jobId).set({
    status: 'success',
    currentStage: 'completed',
    updatedAt: finishedAt,
    resultSummary: {
      facilitiesCount: facilitiesSnap.size,
      markedExcellentCount: updatedExcellent,
      sigunguIndexSidoCount: sigunguMap.size,
    },
  }, { merge: true });
}
