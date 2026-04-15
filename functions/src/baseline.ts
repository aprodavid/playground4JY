import { BASELINE_INVOCATION_PAGE_BUDGET, callApi, clearFacilitiesBySido, db, EXFC_URL, INSTALL_PLACES, nowIso, PFCT_URL, ZERO_PAGE_LIMIT, normalizeFacility } from './shared.js';

type BaselineMeta = Record<string, unknown> & {
  regionKey: string;
  sido: string;
  status: string;
  baselineBuildMode?: 'normal' | 'force-rebuild';
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPages?: number | null;
  pagesFetched?: number;
  rawFacilityCount?: number;
  filteredFacilityCount?: number;
  consecutiveZeroItemPages?: number;
  stopRequested?: boolean;
};

function baselineDocId(sido: string) { return `baseline:${sido}`; }

export async function runSelectedSidoBaseline(sido: string, serviceKey: string) {
  const ref = db.collection('cacheMeta').doc(baselineDocId(sido));
  const snap = await ref.get();
  const meta = (snap.data() ?? {}) as BaselineMeta;
  const now = nowIso();

  if (meta.stopRequested) {
    await ref.set({ status: 'stopped', baselineReady: false, updatedAt: now }, { merge: true });
    return { stopped: true };
  }

  if ((meta.baselineBuildMode ?? 'normal') === 'force-rebuild') {
    await clearFacilitiesBySido(sido);
    await db.collection('sigunguIndex').doc(sido).delete().catch(() => undefined);
  }

  await ref.set({
    status: 'running',
    baselineReady: false,
    currentStage: 'pfc3',
    lastError: null,
    updatedAt: now,
  }, { merge: true });

  let currentInstallIdx = INSTALL_PLACES.indexOf(String(meta.currentInstallPlace ?? INSTALL_PLACES[0]) as (typeof INSTALL_PLACES)[number]);
  if (currentInstallIdx < 0) currentInstallIdx = 0;
  let currentPage = Number(meta.currentPage ?? 1);
  let pagesFetched = Number(meta.pagesFetched ?? 0);
  let rawFacilityCount = Number(meta.rawFacilityCount ?? 0);
  let filteredFacilityCount = Number(meta.filteredFacilityCount ?? 0);
  let zeroPages = Number(meta.consecutiveZeroItemPages ?? 0);

  for (let budget = 0; budget < BASELINE_INVOCATION_PAGE_BUDGET && currentInstallIdx < INSTALL_PLACES.length; budget += 1) {
    const place = INSTALL_PLACES[currentInstallIdx];
    const fetched = await callApi(PFCT_URL, { inslPlcSeCd: place, pageIndex: currentPage, recordCountPerPage: 200, pageNo: currentPage, numOfRows: 200 }, serviceKey);
    const pageItems = fetched.list;

    if (pageItems.length === 0) {
      zeroPages += 1;
      const parserError = `parser-zero-items: place=${place} page=${currentPage} parsePath=${fetched.parsePathUsed}`;
      await ref.set({
        status: 'error',
        baselineReady: false,
        currentStage: 'pfc3',
        currentInstallPlace: place,
        currentPage,
        totalPages: fetched.totalPages,
        pagesFetched: pagesFetched + 1,
        rawFacilityCount,
        filteredFacilityCount,
        lastPageItemCount: 0,
        parsePathUsed: fetched.parsePathUsed,
        consecutiveZeroItemPages: zeroPages,
        lastError: parserError,
        updatedAt: nowIso(),
      }, { merge: true });
      if (zeroPages >= ZERO_PAGE_LIMIT) throw new Error(parserError);
    }

    const normalized = pageItems.map((r) => normalizeFacility(r, false)).filter((doc) => doc !== null) as Record<string, unknown>[];
    const writer = db.bulkWriter();
    normalized.forEach((doc) => writer.set(db.collection('facilities').doc(String(doc.pfctSn)), doc, { merge: true }));
    await writer.close();

    pagesFetched += 1;
    rawFacilityCount += pageItems.length;
    filteredFacilityCount += normalized.length;
    if (pageItems.length > 0) zeroPages = 0;

    const reachedEnd = fetched.totalPages ? currentPage >= fetched.totalPages : pageItems.length < 200;
    currentPage = reachedEnd ? 1 : currentPage + 1;
    if (reachedEnd) currentInstallIdx += 1;

    await ref.set({
      status: 'running',
      baselineReady: false,
      currentStage: 'pfc3',
      currentInstallPlace: place,
      currentPage,
      totalPages: fetched.totalPages,
      pagesFetched,
      rawFacilityCount,
      filteredFacilityCount,
      lastPageItemCount: pageItems.length,
      parsePathUsed: fetched.parsePathUsed,
      consecutiveZeroItemPages: zeroPages,
      lastError: null,
      updatedAt: nowIso(),
    }, { merge: true });
  }

  if (currentInstallIdx < INSTALL_PLACES.length) return { processed: true, continuation: true };

  await ref.set({ currentStage: 'exfc5', currentPage: 1, currentInstallPlace: null, updatedAt: nowIso() }, { merge: true });
  const excellentSet = new Set<string>();
  let exPage = 1;
  let exTotalPages: number | null = null;
  for (;;) {
    const fetched = await callApi(EXFC_URL, { pageIndex: exPage, recordCountPerPage: 200, pageNo: exPage, numOfRows: 200 }, serviceKey);
    fetched.list.forEach((row) => {
      const id = String((row.pfctSn ?? '')).trim();
      if (id) excellentSet.add(id);
    });
    exTotalPages = fetched.totalPages;
    await ref.set({ currentStage: 'exfc5', currentPage: exPage, totalPages: exTotalPages, lastPageItemCount: fetched.list.length, parsePathUsed: fetched.parsePathUsed, pagesFetched: pagesFetched + exPage, updatedAt: nowIso() }, { merge: true });
    const end = fetched.totalPages ? exPage >= fetched.totalPages : fetched.list.length < 200;
    if (end) break;
    exPage += 1;
  }

  const facilitySnap = await db.collection('facilities').where('sido', '==', sido).get();
  const sigungu = new Set<string>();
  const writer = db.bulkWriter();
  facilitySnap.docs.forEach((doc) => {
    const data = doc.data();
    const isExcellent = excellentSet.has(String(data.pfctSn ?? ''));
    if (isExcellent !== Boolean(data.isExcellent)) writer.set(doc.ref, { isExcellent, updatedAt: nowIso() }, { merge: true });
    if (typeof data.sigungu === 'string' && data.sigungu) sigungu.add(data.sigungu);
  });
  await writer.close();

  await db.collection('sigunguIndex').doc(sido).set({ sido, sigungu: [...sigungu].sort(), updatedAt: nowIso() }, { merge: true });
  const doneAt = nowIso();
  await ref.set({
    status: 'success',
    baselineReady: true,
    currentStage: 'success',
    currentInstallPlace: null,
    currentPage: 1,
    totalPages: null,
    pagesFetched,
    rawFacilityCount,
    filteredFacilityCount,
    lastError: null,
    lastSuccessfulBaselineAt: doneAt,
    updatedAt: doneAt,
    stopRequested: false,
  }, { merge: true });

  return { processed: true, success: true, sido };
}
