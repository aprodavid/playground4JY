import {
  BASELINE_FILTERED_ZERO_STREAK_LIMIT,
  BASELINE_INVOCATION_PAGE_BUDGET,
  callApi,
  clearFacilitiesBySido,
  db,
  EXFC_URL,
  extractRegionFromRaw,
  INSTALL_PLACES,
  nowIso,
  normalizeFacility,
  normalizeSido,
  PARSER_DEBUG_VERSION,
  PFCT_URL,
  ZERO_PAGE_LIMIT,
  type BaselineFailureReason,
} from './shared.js';

type BaselineMeta = Record<string, unknown> & {
  regionKey: string;
  sido: string;
  status: string;
  baselineBuildMode?: 'normal' | 'force-rebuild';
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPagesCurrentInstallPlace?: number | null;
  totalPagesOverall?: number | null;
  pagesFetched?: number;
  rawFacilityCount?: number;
  filteredFacilityCount?: number;
  consecutiveZeroItemPages?: number;
  consecutiveAllFilteredOutPages?: number;
  stopRequested?: boolean;
  installPlaceFilterMode?: 'api' | 'server';
  installPlaceApiReliable?: boolean;
};

type PageDiagnostics = {
  selectedSido: string;
  currentInstallPlace: string | null;
  currentPage: number;
  rawItemCount: number;
  uniqueInstallPlaceValues: string[];
  uniqueCandidateSidos: string[];
  matchedByInstallPlace: number;
  matchedBySido: number;
  finalFilteredCount: number;
  filterReasonCounts: Record<BaselineFailureReason, number>;
};

function baselineDocId(sido: string) { return `baseline:${sido}`; }

function emptyReasonCounts() {
  return {
    'missing-sido': 0,
    'installPlace-mismatch': 0,
    'sido-mismatch': 0,
    'invalid-pfctSn': 0,
    'empty-address': 0,
    'parser-zero-items': 0,
  } satisfies Record<BaselineFailureReason, number>;
}

function uniqueInstallPlaces(rows: Record<string, unknown>[]) {
  return [...new Set(rows.map((row) => String(row.inslPlcSeCd ?? '').trim()).filter(Boolean))].sort();
}

function formatFailureForError(reasonCounts: Record<BaselineFailureReason, number>, selectedSido: string, place: string | null) {
  return `all pages filtered out: selectedSido=${selectedSido} place=${place ?? 'ALL'} reasons=${JSON.stringify(reasonCounts)}`;
}

function filterAndNormalizePage(
  rows: Record<string, unknown>[],
  selectedSido: string,
  expectedInstallPlace: string | null,
): { docs: Record<string, unknown>[]; diagnostics: PageDiagnostics } {
  const normalizedSelectedSido = normalizeSido(selectedSido);
  const reasonCounts = emptyReasonCounts();
  const docs: Record<string, unknown>[] = [];
  const candidateSidos = new Set<string>();
  let matchedByInstallPlace = 0;
  let matchedBySido = 0;

  rows.forEach((row) => {
    const pfctSn = String(row.pfctSn ?? row['시설일련번호'] ?? '').trim();
    if (!pfctSn) {
      reasonCounts['invalid-pfctSn'] += 1;
      return;
    }

    const region = extractRegionFromRaw(row);
    region.normalizedSidoCandidates.forEach((candidate) => candidateSidos.add(candidate));

    if (!region.address) {
      reasonCounts['empty-address'] += 1;
      return;
    }

    const installPlaceCode = String(row.inslPlcSeCd ?? '').trim();
    const installMatches = expectedInstallPlace ? installPlaceCode === expectedInstallPlace : INSTALL_PLACES.includes(installPlaceCode as (typeof INSTALL_PLACES)[number]);
    if (!installMatches) {
      reasonCounts['installPlace-mismatch'] += 1;
      return;
    }
    matchedByInstallPlace += 1;

    if (!region.selectedSido) {
      reasonCounts['missing-sido'] += 1;
      return;
    }

    if (normalizeSido(region.selectedSido) !== normalizedSelectedSido) {
      reasonCounts['sido-mismatch'] += 1;
      return;
    }
    matchedBySido += 1;

    const doc = normalizeFacility(row, false);
    if (!doc) {
      reasonCounts['invalid-pfctSn'] += 1;
      return;
    }

    docs.push(doc);
  });

  return {
    docs,
    diagnostics: {
      selectedSido: normalizedSelectedSido,
      currentInstallPlace: expectedInstallPlace,
      currentPage: 1,
      rawItemCount: rows.length,
      uniqueInstallPlaceValues: uniqueInstallPlaces(rows),
      uniqueCandidateSidos: [...candidateSidos].sort(),
      matchedByInstallPlace,
      matchedBySido,
      finalFilteredCount: docs.length,
      filterReasonCounts: reasonCounts,
    },
  };
}

function toErrorState(ref: FirebaseFirestore.DocumentReference, patch: Record<string, unknown>) {
  return ref.set({ status: 'error', baselineReady: false, currentStage: 'pfc3', ...patch, updatedAt: nowIso() }, { merge: true });
}

export async function runSelectedSidoBaseline(sido: string, serviceKey: string) {
  const ref = db.collection('cacheMeta').doc(baselineDocId(sido));
  const snap = await ref.get();
  const meta = (snap.data() ?? {}) as BaselineMeta;
  const selectedSido = normalizeSido(sido);

  if (meta.stopRequested) {
    await ref.set({ status: 'stopped', baselineReady: false, updatedAt: nowIso() }, { merge: true });
    return { stopped: true };
  }

  if ((meta.baselineBuildMode ?? 'normal') === 'force-rebuild') {
    await clearFacilitiesBySido(selectedSido);
    await db.collection('sigunguIndex').doc(selectedSido).delete().catch(() => undefined);
  }

  await ref.set({
    status: 'running',
    baselineReady: false,
    currentStage: 'pfc3',
    lastError: null,
    parserDebugVersion: PARSER_DEBUG_VERSION,
    updatedAt: nowIso(),
  }, { merge: true });

  const installFilterMode = meta.installPlaceFilterMode ?? 'api';
  const apiReliable = meta.installPlaceApiReliable ?? true;

  let currentInstallIdx = INSTALL_PLACES.indexOf(String(meta.currentInstallPlace ?? INSTALL_PLACES[0]) as (typeof INSTALL_PLACES)[number]);
  if (currentInstallIdx < 0) currentInstallIdx = 0;

  let currentPage = Number(meta.currentPage ?? 1);
  let pagesFetched = Number(meta.pagesFetched ?? 0);
  let rawFacilityCount = Number(meta.rawFacilityCount ?? 0);
  let filteredFacilityCount = Number(meta.filteredFacilityCount ?? 0);
  let zeroPages = Number(meta.consecutiveZeroItemPages ?? 0);
  let allFilteredOutStreak = Number(meta.consecutiveAllFilteredOutPages ?? 0);
  let activeMode: 'api' | 'server' = installFilterMode;
  let installPlaceApiReliable = apiReliable;

  for (let budget = 0; budget < BASELINE_INVOCATION_PAGE_BUDGET; budget += 1) {
    const place = activeMode === 'api' ? INSTALL_PLACES[currentInstallIdx] : null;
    if (activeMode === 'api' && currentInstallIdx >= INSTALL_PLACES.length) break;

    const requestParams: Record<string, string | number> = { pageIndex: currentPage, recordCountPerPage: 200, pageNo: currentPage, numOfRows: 200 };
    if (place) requestParams.inslPlcSeCd = place;

    const fetched = await callApi(PFCT_URL, requestParams, serviceKey);
    const pageItems = fetched.list;

    if (pageItems.length === 0) {
      zeroPages += 1;
      const reasonCounts = emptyReasonCounts();
      reasonCounts['parser-zero-items'] = 1;
      const parserError = `parser-zero-items: mode=${activeMode} place=${place ?? 'ALL'} page=${currentPage} parsePath=${fetched.parsePathUsed}`;
      await toErrorState(ref, {
        currentInstallPlace: place,
        currentPage,
        totalPagesCurrentInstallPlace: place ? fetched.totalPages : null,
        totalPagesOverall: place ? meta.totalPagesOverall ?? null : fetched.totalPages,
        pagesFetched: pagesFetched + 1,
        rawFacilityCount,
        filteredFacilityCount,
        lastPageItemCount: 0,
        parsePathUsed: fetched.parsePathUsed,
        consecutiveZeroItemPages: zeroPages,
        lastPageUniqueInstallPlaces: [],
        lastPageSampleSidos: [],
        lastPageFilterReasonCounts: reasonCounts,
        lastError: parserError,
      });
      if (zeroPages >= ZERO_PAGE_LIMIT) throw new Error(parserError);
    }

    const filtered = filterAndNormalizePage(pageItems, selectedSido, place);
    filtered.diagnostics.currentPage = currentPage;
    filtered.diagnostics.currentInstallPlace = place;

    if (activeMode === 'api') {
      const offPlaceCount = filtered.diagnostics.uniqueInstallPlaceValues.filter((code) => code !== place).length;
      if (offPlaceCount > 0) {
        installPlaceApiReliable = false;
        activeMode = 'server';
        currentPage = 1;
        currentInstallIdx = INSTALL_PLACES.length;
        await ref.set({
          installPlaceFilterMode: 'server',
          installPlaceApiReliable: false,
          installPlaceFilterVerification: {
            requestedInstallPlace: place,
            observedInstallPlaces: filtered.diagnostics.uniqueInstallPlaceValues,
            mismatchDetectedAtPage: filtered.diagnostics.currentPage,
            switchedAt: nowIso(),
          },
          currentInstallPlace: null,
          currentPage: 1,
          totalPagesCurrentInstallPlace: null,
          totalPagesOverall: null,
          updatedAt: nowIso(),
        }, { merge: true });
        continue;
      }
    }

    if (filtered.docs.length > 0) {
      const writer = db.bulkWriter();
      filtered.docs.forEach((doc) => writer.set(db.collection('facilities').doc(String(doc.pfctSn)), doc, { merge: true }));
      await writer.close();
    }

    pagesFetched += 1;
    rawFacilityCount += pageItems.length;
    filteredFacilityCount += filtered.docs.length;

    zeroPages = pageItems.length > 0 ? 0 : zeroPages;
    allFilteredOutStreak = filtered.docs.length === 0 ? allFilteredOutStreak + 1 : 0;

    if (allFilteredOutStreak >= BASELINE_FILTERED_ZERO_STREAK_LIMIT && pageItems.length > 0) {
      const errorMessage = formatFailureForError(filtered.diagnostics.filterReasonCounts, selectedSido, place);
      await toErrorState(ref, {
        currentInstallPlace: place,
        currentPage,
        pagesFetched,
        rawFacilityCount,
        filteredFacilityCount,
        totalPagesCurrentInstallPlace: place ? fetched.totalPages : null,
        totalPagesOverall: place ? meta.totalPagesOverall ?? null : fetched.totalPages,
        lastPageItemCount: pageItems.length,
        parsePathUsed: fetched.parsePathUsed,
        consecutiveZeroItemPages: zeroPages,
        consecutiveAllFilteredOutPages: allFilteredOutStreak,
        lastPageUniqueInstallPlaces: filtered.diagnostics.uniqueInstallPlaceValues,
        lastPageSampleSidos: filtered.diagnostics.uniqueCandidateSidos.slice(0, 10),
        lastPageFilterReasonCounts: filtered.diagnostics.filterReasonCounts,
        lastError: errorMessage,
        baselineLastError: errorMessage,
      });
      throw new Error(errorMessage);
    }

    const reachedEnd = fetched.totalPages ? currentPage >= fetched.totalPages : pageItems.length < 200;

    if (activeMode === 'api') {
      currentPage = reachedEnd ? 1 : currentPage + 1;
      if (reachedEnd) currentInstallIdx += 1;
    } else {
      currentPage = reachedEnd ? 1 : currentPage + 1;
    }

    const totalPagesCurrentInstallPlace = activeMode === 'api' ? fetched.totalPages : null;
    const totalPagesOverall = activeMode === 'server' ? fetched.totalPages : null;

    await ref.set({
      status: 'running',
      baselineReady: false,
      currentStage: 'pfc3',
      parserDebugVersion: PARSER_DEBUG_VERSION,
      installPlaceFilterMode: activeMode,
      installPlaceApiReliable,
      currentInstallPlace: activeMode === 'api' ? place : null,
      currentPage,
      totalPagesCurrentInstallPlace,
      totalPagesOverall,
      pagesFetched,
      rawFacilityCount,
      filteredFacilityCount,
      lastPageItemCount: pageItems.length,
      parsePathUsed: fetched.parsePathUsed,
      consecutiveZeroItemPages: zeroPages,
      consecutiveAllFilteredOutPages: allFilteredOutStreak,
      lastPageUniqueInstallPlaces: filtered.diagnostics.uniqueInstallPlaceValues,
      lastPageSampleSidos: filtered.diagnostics.uniqueCandidateSidos.slice(0, 10),
      lastPageFilterReasonCounts: filtered.diagnostics.filterReasonCounts,
      lastPageMatchStats: {
        selectedSido,
        matchedByInstallPlace: filtered.diagnostics.matchedByInstallPlace,
        matchedBySido: filtered.diagnostics.matchedBySido,
        finalFilteredCount: filtered.diagnostics.finalFilteredCount,
      },
      lastError: null,
      updatedAt: nowIso(),
    }, { merge: true });

    if (activeMode === 'server' && reachedEnd) break;
  }

  if ((activeMode === 'api' && currentInstallIdx < INSTALL_PLACES.length) || (activeMode === 'server' && currentPage !== 1)) {
    return { processed: true, continuation: true };
  }

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
    await ref.set({
      currentStage: 'exfc5',
      currentPage: exPage,
      totalPagesOverall: exTotalPages,
      totalPagesCurrentInstallPlace: null,
      lastPageItemCount: fetched.list.length,
      parsePathUsed: fetched.parsePathUsed,
      pagesFetched: pagesFetched + exPage,
      updatedAt: nowIso(),
    }, { merge: true });
    const end = fetched.totalPages ? exPage >= fetched.totalPages : fetched.list.length < 200;
    if (end) break;
    exPage += 1;
  }

  const facilitySnap = await db.collection('facilities').where('sido', '==', selectedSido).get();
  const sigungu = new Set<string>();
  const writer = db.bulkWriter();
  facilitySnap.docs.forEach((doc) => {
    const data = doc.data();
    const isExcellent = excellentSet.has(String(data.pfctSn ?? ''));
    if (isExcellent !== Boolean(data.isExcellent)) writer.set(doc.ref, { isExcellent, updatedAt: nowIso() }, { merge: true });
    if (typeof data.sigungu === 'string' && data.sigungu) sigungu.add(data.sigungu);
  });
  await writer.close();

  await db.collection('sigunguIndex').doc(selectedSido).set({ sido: selectedSido, sigungu: [...sigungu].sort(), updatedAt: nowIso() }, { merge: true });
  const doneAt = nowIso();
  await ref.set({
    status: 'success',
    baselineReady: true,
    currentStage: 'success',
    currentInstallPlace: null,
    currentPage: 1,
    totalPagesCurrentInstallPlace: null,
    totalPagesOverall: null,
    pagesFetched,
    rawFacilityCount,
    filteredFacilityCount,
    parserDebugVersion: PARSER_DEBUG_VERSION,
    lastError: null,
    lastSuccessfulBaselineAt: doneAt,
    consecutiveAllFilteredOutPages: 0,
    updatedAt: doneAt,
    stopRequested: false,
  }, { merge: true });

  return {
    processed: true,
    success: true,
    sido: selectedSido,
    installPlaceApiReliable,
    installPlaceFilterMode: activeMode,
  };
}
