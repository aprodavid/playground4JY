import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();
const db = getFirestore();

const PUBLIC_DATA_BASE_URL = defineString('PUBLIC_DATA_BASE_URL');
const PUBLIC_DATA_SERVICE_KEY = defineSecret('PUBLIC_DATA_SERVICE_KEY');
const BASELINE_META_KEY = 'baseline:global';
const INSTALL_PLACES = ['A003', 'A022', 'A033'] as const;
const BASELINE_STEP_BUDGET = 2;
const RIDE_STEP_TARGETS = 40;
type NormalizedFacility = Record<string, unknown> & { contentHash: string; pfctSn: number };

type JobType = 'baseline' | 'ride';
type JobStatus = 'queued' | 'running' | 'success' | 'error' | 'stopped';

type JobDoc = {
  jobId: string;
  type: JobType;
  status: JobStatus;
  startedAt?: string;
  updatedAt?: string;
  stopRequested?: boolean;
  currentStage?: string | null;
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPages?: number | null;
  pagesFetched?: number;
  rawFacilityCount?: number;
  filteredFacilityCount?: number;
  successCount?: number;
  errorCount?: number;
  lastError?: string | null;
  resultSummary?: Record<string, unknown> | null;
  cursor?: {
    stage?: 'pfc3' | 'exfc5' | 'finalize';
    installPlaceIndex?: number;
    page?: number;
    excellentPage?: number;
    excellent?: number[];
    offset?: number;
    targets?: number[];
    initialized?: boolean;
    scannedTargets?: number;
  };
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeSido(input?: string) {
  if (!input) return '';
  const compact = input.replace(/\s+/g, '');
  const map: Record<string, string> = {
    서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시',
    대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도',
    충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도',
    경남: '경상남도', 제주: '제주특별자치도',
  };
  if (map[input]) return map[input];
  for (const [k, v] of Object.entries(map)) {
    if (v.replace(/\s+/g, '') === compact || k === compact) return v;
  }
  return input;
}

function normalizeSigungu(input?: string) {
  return (input ?? '').replace(/\s+/g, '');
}

function pick(raw: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return undefined;
}

function num(v: unknown) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function txt(v: unknown) {
  const s = String(v ?? '').trim();
  return s || undefined;
}

function computeFacilityHash(doc: Record<string, unknown>) {
  const payload = JSON.stringify({
    pfctSn: doc.pfctSn,
    facilityName: doc.facilityName,
    installPlaceCode: doc.installPlaceCode,
    normalizedAddress: doc.normalizedAddress,
    sido: doc.sido,
    sigungu: doc.sigungu,
    installYear: doc.installYear ?? null,
    area: doc.area,
    lat: doc.lat ?? null,
    lng: doc.lng ?? null,
    isExcellent: doc.isExcellent,
  });
  return createHash('sha1').update(payload).digest('hex');
}

function normalizeFacility(raw: Record<string, unknown>, isExcellent: boolean) {
  const address = txt(pick(raw, ['rdnmadr', 'lnmadr', 'addr', 'detailAddr', 'address', '소재지도로명주소', '소재지지번주소'])) ?? '';
  const tokens = address.split(' ').filter(Boolean);
  const sido = normalizeSido(txt(pick(raw, ['sido', '시도'])) ?? tokens[0] ?? '');
  const sigungu = normalizeSigungu(txt(pick(raw, ['sigungu', '시군구'])) ?? tokens[1] ?? '');
  const pfctSn = Number(pick(raw, ['pfctSn', '시설일련번호']));
  if (!Number.isFinite(pfctSn) || !sido) return null;

  const normalized = {
    pfctSn,
    facilityName: txt(pick(raw, ['pfctNm', '시설명'])) ?? '이름없음',
    installPlaceCode: String(pick(raw, ['inslPlcSeCd'])) || 'A003',
    address,
    normalizedAddress: address.replace(/\s+/g, ' ').trim(),
    sido,
    sigungu,
    installYear: num(pick(raw, ['instlYy', '설치연도'])),
    area: num(pick(raw, ['ar', '면적'])) ?? 400,
    areaMissing: num(pick(raw, ['ar', '면적'])) === undefined,
    lat: num(pick(raw, ['latitude', 'lat', '위도'])),
    lng: num(pick(raw, ['longitude', 'lng', '경도'])),
    isExcellent,
    updatedAt: nowIso(),
  } as Record<string, unknown>;

  return {
    ...normalized,
    contentHash: computeFacilityHash(normalized),
  };
}

async function callApi(endpoint: string, params: Record<string, string | number>, key: string) {
  const base = PUBLIC_DATA_BASE_URL.value().replace(/\/$/, '');
  const attempts: string[] = [];
  const keyCandidates = [key, encodeURIComponent(key)].filter((v, i, arr) => arr.indexOf(v) === i);

  let lastStatus = 0;
  let lastText = '';
  for (const candidate of keyCandidates) {
    const url = new URL(`${base}${endpoint}`);
    url.searchParams.set('serviceKey', candidate);
    url.searchParams.set('_type', 'json');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    const res = await fetch(url.toString(), { cache: 'no-store' });
    attempts.push(`${candidate === key ? 'raw' : 'encoded'}:${res.status}`);
    lastStatus = res.status;
    if (!res.ok) {
      lastText = await res.text();
      continue;
    }

    const json = await res.json() as {
      response?: { body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] }; totalPageCnt?: number } };
    };
    const body = json?.response?.body;
    const items = body?.items?.item;
    const list = Array.isArray(items) ? items : items ? [items] : [];

    return {
      list,
      totalPages: Number(body?.totalPageCnt || 0) || null,
    };
  }

  throw new Error(`public api failed ${endpoint} status=${lastStatus} attempts=${attempts.join(',')} detail=${lastText.slice(0, 300)}`);
}

async function upsertBaselineMeta(patch: Record<string, unknown>) {
  await db.collection('cacheMeta').doc(BASELINE_META_KEY).set({
    regionKey: BASELINE_META_KEY,
    ...patch,
  }, { merge: true });
}

async function clearCollection(name: string) {
  while (true) {
    const snap = await db.collection(name).limit(400).get();
    if (snap.empty) break;
    const writer = db.bulkWriter();
    snap.docs.forEach((d) => writer.delete(d.ref));
    await writer.close();
  }
}

async function upsertFacilitiesWithDiff(facilities: Record<string, unknown>[]) {
  if (facilities.length === 0) return { writes: 0, skipped: 0 };
  const refs = facilities.map((f) => db.collection('facilities').doc(String(f.pfctSn)));
  const snapshots = await db.getAll(...refs);
  const existingMap = new Map<string, Record<string, unknown>>();
  snapshots.forEach((s) => { if (s.exists) existingMap.set(s.id, s.data() as Record<string, unknown>); });

  const writer = db.bulkWriter();
  let writes = 0;
  let skipped = 0;

  for (const facility of facilities) {
    const id = String(facility.pfctSn);
    const existing = existingMap.get(id);
    if (existing?.contentHash && existing.contentHash === facility.contentHash) {
      skipped += 1;
      continue;
    }
    writer.set(db.collection('facilities').doc(id), facility, { merge: true });
    writes += 1;
  }

  await writer.close();
  return { writes, skipped };
}

async function processBaselineStep(job: JobDoc, serviceKey: string) {
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

async function loadRideTargets() {
  const snap = await db.collection('facilities').get();
  const coordinateWinner = new Map<string, number>();

  snap.docs.forEach((d) => {
    const x = d.data();
    const pfctSn = Number(x.pfctSn);
    if (!Number.isFinite(pfctSn)) return;
    const key = x.lat && x.lng ? `${Number(x.lat).toFixed(6)}:${Number(x.lng).toFixed(6)}` : `pfct:${pfctSn}`;
    const existing = coordinateWinner.get(key);
    if (!existing || pfctSn < existing) coordinateWinner.set(key, pfctSn);
  });

  return [...coordinateWinner.values()];
}

async function processRideStep(job: JobDoc, serviceKey: string) {
  const now = nowIso();
  const targets = job.cursor?.targets ?? await loadRideTargets();
  let offset = job.cursor?.offset ?? 0;
  let scanned = 0;
  let success = 0;
  let error = 0;

  const selected: number[] = [];
  while (offset < targets.length && selected.length < RIDE_STEP_TARGETS) {
    const pfctSn = targets[offset];
    offset += 1;
    scanned += 1;
    const existing = await db.collection('rideCache').doc(String(pfctSn)).get();
    if (existing.exists) {
      continue;
    }
    selected.push(pfctSn);
  }

  const writer = db.bulkWriter();
  for (const pfctSn of selected) {
    try {
      const fetched = await callApi('/ride4/getRideInfo4', { pfctSn }, serviceKey);
      const types = [...new Set(fetched.list.map((x) => String(x.playkndCd)).filter(Boolean))];
      writer.set(db.collection('rideCache').doc(String(pfctSn)), {
        pfctSn,
        rawCount: fetched.list.length,
        filteredCount: fetched.list.length,
        typeCount: types.length,
        types,
        status: fetched.list.length ? 'ok' : 'empty',
        updatedAt: now,
      }, { merge: true });
      success += 1;
    } catch (e) {
      writer.set(db.collection('rideCache').doc(String(pfctSn)), {
        pfctSn,
        rawCount: 0,
        filteredCount: 0,
        typeCount: 0,
        types: [],
        status: 'error',
        updatedAt: now,
        lastError: e instanceof Error ? e.message : 'unknown error',
      }, { merge: true });
      error += 1;
    }
  }
  await writer.close();

  const done = offset >= targets.length;
  const prevScanned = job.cursor?.scannedTargets ?? 0;

  await db.collection('jobs').doc(job.jobId).set({
    status: done ? 'success' : 'running',
    currentStage: done ? 'completed' : 'ride-batch',
    currentPage: offset,
    totalPages: targets.length,
    pagesFetched: (job.pagesFetched ?? 0) + 1,
    successCount: (job.successCount ?? 0) + success,
    errorCount: (job.errorCount ?? 0) + error,
    cursor: {
      ...job.cursor,
      offset,
      targets,
      scannedTargets: prevScanned + scanned,
    },
    updatedAt: now,
  }, { merge: true });

  await upsertBaselineMeta({
    rideStatus: done ? 'success' : 'running',
    rideUpdatedAt: now,
    rideStartedAt: job.startedAt ?? now,
    rideProgress: {
      totalTargets: targets.length,
      processedTargets: offset,
      updatedTargets: (job.successCount ?? 0) + success,
      errorTargets: (job.errorCount ?? 0) + error,
      skippedExistingTargets: Number((job.cursor?.scannedTargets ?? 0)) + scanned - ((job.successCount ?? 0) + success + (job.errorCount ?? 0) + error),
    },
  });
}

async function processOneJob() {
  const snap = await db.collection('jobs')
    .where('status', 'in', ['queued', 'running'])
    .orderBy('startedAt', 'asc')
    .limit(1)
    .get();

  if (snap.empty) return { processed: false };

  const doc = snap.docs[0];
  const job = { ...(doc.data() as JobDoc), jobId: doc.id };

  if (job.stopRequested) {
    const now = nowIso();
    await doc.ref.set({ status: 'stopped', updatedAt: now, currentStage: 'stopped' }, { merge: true });
    if (job.type === 'baseline') {
      await upsertBaselineMeta({ baselineStatus: 'stopped', status: 'stopped', baselineReady: false, updatedAt: now, baselineUpdatedAt: now, done: true });
    } else {
      await upsertBaselineMeta({ rideStatus: 'stopped', rideUpdatedAt: now });
    }
    return { processed: true, stopped: true, jobId: doc.id };
  }

  const secret = PUBLIC_DATA_SERVICE_KEY.value();
  const now = nowIso();

  if (job.status === 'queued') {
    await doc.ref.set({ status: 'running', currentStage: 'starting', updatedAt: now }, { merge: true });
    if (job.type === 'baseline') {
      await upsertBaselineMeta({
        status: 'running',
        baselineStatus: 'running',
        baselineReady: false,
        baselineSource: 'api-crawl',
        baselineStartedAt: job.startedAt ?? now,
        baselineUpdatedAt: now,
        baselineCurrentStage: 'starting',
        done: false,
        lastError: null,
        baselineLastError: null,
      });
    } else {
      await upsertBaselineMeta({
        rideStatus: 'running',
        rideStartedAt: job.startedAt ?? now,
        rideUpdatedAt: now,
        rideLastError: null,
      });
    }
  }

  try {
    if (job.type === 'baseline') {
      for (let i = 0; i < BASELINE_STEP_BUDGET; i += 1) {
        const fresh = await db.collection('jobs').doc(job.jobId).get();
        const freshJob = fresh.data() as JobDoc | undefined;
        if (!freshJob || freshJob.status === 'success' || freshJob.status === 'stopped' || freshJob.status === 'error') break;
        await processBaselineStep({ ...freshJob, jobId: job.jobId }, secret);
      }
    }

    if (job.type === 'ride') await processRideStep(job, secret);
    return { processed: true, jobId: doc.id, type: job.type };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'unknown error';
    await doc.ref.set({
      status: 'error',
      lastError: errMsg,
      updatedAt: nowIso(),
      errorCount: (job.errorCount ?? 0) + 1,
    }, { merge: true });

    if (job.type === 'baseline') {
      await upsertBaselineMeta({
        status: 'error',
        baselineStatus: 'error',
        baselineReady: false,
        baselineUpdatedAt: nowIso(),
        baselineLastError: errMsg,
        lastError: errMsg,
        done: true,
        lastBuildStatus: 'error',
      });
    } else {
      await upsertBaselineMeta({ rideStatus: 'error', rideUpdatedAt: nowIso(), rideLastError: errMsg });
    }
    throw error;
  }
}

export const workerTick = onSchedule({
  schedule: 'every 2 minutes',
  region: 'asia-northeast3',
  secrets: [PUBLIC_DATA_SERVICE_KEY],
}, async () => {
  await processOneJob();
});

export const workerKick = onRequest({
  region: 'asia-northeast3',
  secrets: [PUBLIC_DATA_SERVICE_KEY],
}, async (_req: unknown, res: { status: (code: number) => { json: (payload: unknown) => void } }) => {
  const result = await processOneJob();
  res.status(200).json(result);
});

export const onJobCreatedKick = onDocumentCreated({
  document: 'jobs/{jobId}',
  region: 'asia-northeast3',
  secrets: [PUBLIC_DATA_SERVICE_KEY],
}, async () => {
  await processOneJob();
});
