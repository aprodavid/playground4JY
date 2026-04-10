import { dedupeByCoordinate, extractRegionFromRaw, stripUndefinedDeep, toFacilityDoc } from '@/lib/normalization';
import { BASELINE_META_KEY, getAllFacilities, getCacheMeta, setCacheMeta, setSigunguIndex, upsertFacilities } from '@/lib/firestore-repo';
import { fetchExfc5WithMeta, fetchPfc3WithMeta, PFC3_INSTALL_PLACE_CODES, PublicDataError } from '@/lib/public-data';
import type { CacheMetaDoc, FacilityDoc } from '@/types/domain';

const DEFAULT_PAGE_SIZE = 200;

const VALID_SIDO = new Set([
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시',
  '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도',
  '전라남도', '경상북도', '경상남도', '제주특별자치도',
]);

export type BaselineJobState = CacheMetaDoc & {
  regionKey: typeof BASELINE_META_KEY;
  jobId: string;
  stage: 'pfc3' | 'exfc5' | 'finalize';
  pfc3InstallPlaceIndex: number;
  excellentPfctSns: number[];
};

export function createJobId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function initRefreshRegionJob() {
  const now = new Date().toISOString();
  const meta: BaselineJobState = {
    regionKey: BASELINE_META_KEY,
    jobId: createJobId(),
    lastBuiltAt: now,
    lastBuildStatus: 'ok',
    facilitiesCount: 0,
    excellentCount: 0,
    status: 'running',
    done: false,
    startedAt: now,
    updatedAt: now,
    currentStage: 'pfc3',
    currentInstallPlace: PFC3_INSTALL_PLACE_CODES[0],
    currentPage: 1,
    totalPages: null,
    pagesFetched: 0,
    rawFacilityCount: 0,
    filteredFacilityCount: 0,
    successCount: 0,
    errorCount: 0,
    lastError: null,
    stopRequested: false,
    baselineStatus: 'running',
    baselinePagesFetched: 0,
    baselineRawFacilityCount: 0,
    baselineFilteredFacilityCount: 0,
    baselineStartedAt: now,
    baselineUpdatedAt: now,
    baselineLastError: null,
    baselineCurrentStage: 'pfc3',
    baselineCurrentInstallPlace: PFC3_INSTALL_PLACE_CODES[0],
    baselineCurrentPage: 1,
    baselineTotalPages: null,
    baselineSampleMatchedRegions: [],
    baselineUnmatchedReasonCount: {},
    stage: 'pfc3',
    pfc3InstallPlaceIndex: 0,
    excellentPfctSns: [],
  };

  await setCacheMeta(BASELINE_META_KEY, meta);
  return meta;
}

export async function getRefreshRegionJob(): Promise<BaselineJobState | null> {
  const meta = await getCacheMeta(BASELINE_META_KEY);
  if (!meta) return null;
  return meta as BaselineJobState;
}

function jobErrorPayload(error: unknown, endpoint?: string | null) {
  if (error instanceof PublicDataError) {
    return {
      message: 'baseline facilities build failed',
      errorType: error.detail.type,
      status: error.detail.status ?? null,
      endpoint: error.detail.endpoint,
      attempts: error.detail.attempts ?? [],
      detailMessage: error.message,
    };
  }

  return {
    message: 'baseline facilities build failed',
    errorType: 'unknown',
    endpoint: endpoint ?? null,
    detailMessage: error instanceof Error ? error.message : 'unknown error',
  };
}

async function persistError(meta: BaselineJobState, error: unknown, endpoint?: string | null) {
  const updatedAt = new Date().toISOString();
  const payload = jobErrorPayload(error, endpoint);
  await setCacheMeta(BASELINE_META_KEY, {
    ...meta,
    status: 'error',
    baselineStatus: 'error',
    lastBuildStatus: 'error',
    done: true,
    updatedAt,
    baselineUpdatedAt: updatedAt,
    lastBuiltAt: updatedAt,
    lastError: payload.detailMessage,
    baselineLastError: payload.detailMessage,
    errorCount: (meta.errorCount ?? 0) + 1,
    buildDurationMs: Date.now() - new Date(meta.startedAt ?? updatedAt).getTime(),
  });

  return payload;
}

function addUnmatchedReason(meta: BaselineJobState, reason: string) {
  const current = meta.baselineUnmatchedReasonCount ?? {};
  current[reason] = (current[reason] ?? 0) + 1;
  meta.baselineUnmatchedReasonCount = current;
}

function noteSampleRegion(meta: BaselineJobState, regionName: string) {
  const samples = new Set(meta.baselineSampleMatchedRegions ?? []);
  if (samples.size < 12 && regionName) samples.add(regionName);
  meta.baselineSampleMatchedRegions = [...samples];
}

function normalizePfc3Rows(meta: BaselineJobState, rows: Record<string, unknown>[]) {
  const docs: FacilityDoc[] = [];
  for (const row of rows) {
    const region = extractRegionFromRaw(row);
    if (!region.sido) {
      addUnmatchedReason(meta, 'missing-sido');
      continue;
    }
    if (!VALID_SIDO.has(region.sido)) {
      addUnmatchedReason(meta, `unknown-sido:${region.sido}`);
      continue;
    }
    const pfctSn = Number(row.pfctSn);
    if (!Number.isFinite(pfctSn)) {
      addUnmatchedReason(meta, 'invalid-pfctSn');
      continue;
    }

    const doc = toFacilityDoc(row, false);
    if (!doc.sido) {
      addUnmatchedReason(meta, 'normalized-sido-empty');
      continue;
    }

    noteSampleRegion(meta, `${doc.sido} ${doc.sigungu || '(sigungu-empty)'}`);
    docs.push(stripUndefinedDeep(doc));
  }

  return dedupeByCoordinate(docs);
}

function computeTotalPages(totalPageCnt: number | null, totalCount: number | null, pageSize: number) {
  if (totalPageCnt) return totalPageCnt;
  if (totalCount) return Math.ceil(totalCount / pageSize);
  return null;
}

export async function continueRefreshRegionJob(meta: BaselineJobState) {
  if (meta.done || meta.status !== 'running') return meta;

  try {
    if (meta.stopRequested) {
      const now = new Date().toISOString();
      const stopped: BaselineJobState = {
        ...meta,
        status: 'stopped',
        baselineStatus: 'stopped',
        done: true,
        updatedAt: now,
        baselineUpdatedAt: now,
        lastBuiltAt: now,
        lastBuildStatus: 'error',
        baselineLastError: 'stopped by operator',
        lastError: 'stopped by operator',
      };
      await setCacheMeta(BASELINE_META_KEY, stopped);
      return stopped;
    }

    const pageSize = DEFAULT_PAGE_SIZE;
    const currentPage = meta.currentPage ?? 1;

    if (meta.stage === 'pfc3') {
      const installPlace = PFC3_INSTALL_PLACE_CODES[meta.pfc3InstallPlaceIndex] ?? null;
      if (!installPlace) {
        meta.stage = 'exfc5';
        meta.currentStage = 'exfc5';
        meta.baselineCurrentStage = 'exfc5';
        meta.currentInstallPlace = null;
        meta.baselineCurrentInstallPlace = null;
        meta.currentPage = 1;
      } else {
        const page = await fetchPfc3WithMeta({
          inslPlcSeCd: installPlace,
          pageIndex: currentPage,
          recordCountPerPage: pageSize,
          pageNo: currentPage,
          numOfRows: pageSize,
        });

        const normalized = normalizePfc3Rows(meta, page.items);
        await upsertFacilities(normalized);

        const totalPages = computeTotalPages(page.meta.pageInfo.totalPageCnt, page.meta.pageInfo.totalCount, pageSize);
        const reachedEnd = totalPages ? currentPage >= totalPages : page.items.length < pageSize;

        meta.pagesFetched = (meta.pagesFetched ?? 0) + 1;
        meta.baselinePagesFetched = (meta.baselinePagesFetched ?? 0) + 1;
        meta.rawFacilityCount = (meta.rawFacilityCount ?? 0) + page.items.length;
        meta.baselineRawFacilityCount = (meta.baselineRawFacilityCount ?? 0) + page.items.length;
        meta.filteredFacilityCount = (meta.filteredFacilityCount ?? 0) + normalized.length;
        meta.baselineFilteredFacilityCount = (meta.baselineFilteredFacilityCount ?? 0) + normalized.length;
        meta.successCount = (meta.successCount ?? 0) + normalized.length;
        meta.currentInstallPlace = installPlace;
        meta.baselineCurrentInstallPlace = installPlace;
        meta.totalPages = totalPages;
        meta.baselineTotalPages = totalPages;

        if (reachedEnd) {
          meta.pfc3InstallPlaceIndex += 1;
          meta.currentPage = 1;
          meta.baselineCurrentPage = 1;
          if (meta.pfc3InstallPlaceIndex >= PFC3_INSTALL_PLACE_CODES.length) {
            meta.stage = 'exfc5';
            meta.currentStage = 'exfc5';
            meta.baselineCurrentStage = 'exfc5';
            meta.currentInstallPlace = null;
            meta.baselineCurrentInstallPlace = null;
            meta.totalPages = null;
            meta.baselineTotalPages = null;
          }
        } else {
          meta.currentPage = currentPage + 1;
          meta.baselineCurrentPage = currentPage + 1;
        }
      }
    }

    if (meta.stage === 'exfc5') {
      const exfc5 = await fetchExfc5WithMeta({
        pageIndex: currentPage,
        recordCountPerPage: pageSize,
        pageNo: currentPage,
        numOfRows: pageSize,
      });

      const pagePfctSns = exfc5.items
        .map((row) => Number(row.pfctSn))
        .filter((pfctSn) => Number.isFinite(pfctSn));

      const merged = new Set<number>([...(meta.excellentPfctSns ?? []), ...pagePfctSns]);
      meta.excellentPfctSns = [...merged];
      meta.pagesFetched = (meta.pagesFetched ?? 0) + 1;
      meta.baselinePagesFetched = (meta.baselinePagesFetched ?? 0) + 1;
      meta.totalPages = computeTotalPages(exfc5.meta.pageInfo.totalPageCnt, exfc5.meta.pageInfo.totalCount, pageSize);
      meta.baselineTotalPages = meta.totalPages;

      const reachedEnd = meta.totalPages ? currentPage >= meta.totalPages : exfc5.items.length < pageSize;
      if (reachedEnd) {
        meta.stage = 'finalize';
        meta.currentStage = 'finalize';
        meta.baselineCurrentStage = 'finalize';
        meta.currentPage = 1;
        meta.baselineCurrentPage = 1;
      } else {
        meta.currentPage = currentPage + 1;
        meta.baselineCurrentPage = currentPage + 1;
      }
    }

    if (meta.stage === 'finalize') {
      const facilities = await getAllFacilities();
      const excellentSet = new Set(meta.excellentPfctSns ?? []);
      const toUpdate = facilities
        .filter((facility) => excellentSet.has(facility.pfctSn) && !facility.isExcellent)
        .map((facility) => ({ ...facility, isExcellent: true, updatedAt: new Date().toISOString() }));
      await upsertFacilities(toUpdate);

      const sigunguMap = new Map<string, Set<string>>();
      facilities.forEach((facility) => {
        if (!facility.sido) return;
        if (!sigunguMap.has(facility.sido)) sigunguMap.set(facility.sido, new Set());
        if (facility.sigungu) sigunguMap.get(facility.sido)!.add(facility.sigungu);
      });

      for (const [sido, sigunguSet] of sigunguMap.entries()) {
        await setSigunguIndex(sido, [...sigunguSet].sort());
      }

      const startedAtMs = new Date(meta.startedAt ?? new Date().toISOString()).getTime();
      const buildDurationMs = Date.now() - startedAtMs;
      const updatedAt = new Date().toISOString();
      const finalMeta: BaselineJobState = {
        ...meta,
        lastBuiltAt: updatedAt,
        updatedAt,
        baselineUpdatedAt: updatedAt,
        status: 'success',
        baselineStatus: 'success',
        done: true,
        lastBuildStatus: 'ok',
        lastError: null,
        baselineLastError: null,
        currentStage: 'completed',
        baselineCurrentStage: 'completed',
        currentInstallPlace: null,
        baselineCurrentInstallPlace: null,
        facilitiesCount: facilities.length,
        excellentCount: facilities.filter((f) => excellentSet.has(f.pfctSn) || f.isExcellent).length,
        buildDurationMs,
      };
      await setCacheMeta(BASELINE_META_KEY, finalMeta);
      return finalMeta;
    }

    const updatedAt = new Date().toISOString();
    const nextMeta: BaselineJobState = {
      ...meta,
      updatedAt,
      baselineUpdatedAt: updatedAt,
      status: 'running',
      baselineStatus: 'running',
      done: false,
      lastBuildStatus: 'ok',
      buildDurationMs: Date.now() - new Date(meta.startedAt ?? updatedAt).getTime(),
    };
    await setCacheMeta(BASELINE_META_KEY, nextMeta);
    return nextMeta;
  } catch (error) {
    await persistError(meta, error);
    throw error;
  }
}

export async function requestStopRefreshRegionJob() {
  const current = await getRefreshRegionJob();
  if (!current) return null;
  await setCacheMeta(BASELINE_META_KEY, { stopRequested: true, updatedAt: new Date().toISOString(), baselineUpdatedAt: new Date().toISOString() });
  return true;
}

export function buildRegionKey(sido: string, sigungu?: string) {
  return `${sido}:${sigungu ?? 'ALL'}`;
}

export function mapJobError(error: unknown) {
  return jobErrorPayload(error);
}
