import { dedupeByCoordinate, matchesSelectedRegion, stripUndefinedDeep, toFacilityDoc } from '@/lib/normalization';
import { getCacheMeta, getFacilitiesByRegion, setCacheMeta, upsertFacilities } from '@/lib/firestore-repo';
import { fetchExfc5WithMeta, fetchPfc3WithMeta, PFC3_INSTALL_PLACE_CODES, PublicDataError } from '@/lib/public-data';
import type { CacheMetaDoc } from '@/types/domain';

const DEFAULT_PAGE_SIZE = 200;

export type RefreshRegionJobState = CacheMetaDoc & {
  jobId: string;
  stage: 'pfc3' | 'exfc5' | 'finalize';
  pfc3InstallPlaceIndex: number;
  excellentPfctSns: number[];
};

export function buildRegionKey(sido: string, sigungu?: string) {
  return `${sido}:${sigungu ?? 'ALL'}`;
}

export function createJobId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function initRefreshRegionJob(sido: string, sigungu?: string) {
  const regionKey = buildRegionKey(sido, sigungu);
  const now = new Date().toISOString();
  const meta: RefreshRegionJobState = {
    regionKey,
    jobId: createJobId(),
    startedAt: now,
    updatedAt: now,
    lastBuiltAt: now,
    facilitiesCount: 0,
    excellentCount: 0,
    pagesFetched: 0,
    rawFacilityCount: 0,
    filteredFacilityCount: 0,
    successCount: 0,
    errorCount: 0,
    currentStage: 'pfc3',
    currentInstallPlace: PFC3_INSTALL_PLACE_CODES[0],
    currentPage: 1,
    totalPages: null,
    selectedRegion: stripUndefinedDeep({ sido, ...(sigungu ? { sigungu } : {}) }),
    status: 'running',
    done: false,
    lastError: null,
    buildDurationMs: 0,
    lastBuildStatus: 'ok',
    stage: 'pfc3',
    pfc3InstallPlaceIndex: 0,
    excellentPfctSns: [],
  };

  await setCacheMeta(regionKey, meta);
  return meta;
}

export async function getRefreshRegionJob(regionKey: string): Promise<RefreshRegionJobState | null> {
  const meta = await getCacheMeta(regionKey);
  if (!meta) return null;
  return meta as RefreshRegionJobState;
}

function jobErrorPayload(error: unknown, endpoint?: string | null) {
  if (error instanceof PublicDataError) {
    return {
      message: 'refresh-region job failed',
      errorType: error.detail.type,
      status: error.detail.status ?? null,
      endpoint: error.detail.endpoint,
      attempts: error.detail.attempts ?? [],
      detailMessage: error.message,
    };
  }

  return {
    message: 'refresh-region job failed',
    errorType: 'unknown',
    endpoint: endpoint ?? null,
    detailMessage: error instanceof Error ? error.message : 'unknown error',
  };
}

async function persistError(meta: RefreshRegionJobState, error: unknown, endpoint?: string | null) {
  const updatedAt = new Date().toISOString();
  const payload = jobErrorPayload(error, endpoint);
  await setCacheMeta(meta.regionKey, {
    ...meta,
    status: 'error',
    lastBuildStatus: 'error',
    done: true,
    updatedAt,
    lastBuiltAt: updatedAt,
    lastError: payload.detailMessage,
    errorCount: (meta.errorCount ?? 0) + 1,
    buildDurationMs: Date.now() - new Date(meta.startedAt ?? updatedAt).getTime(),
  });

  return payload;
}

export async function continueRefreshRegionJob(meta: RefreshRegionJobState) {
  if (meta.done || meta.status !== 'running') return meta;

  try {
    const selectedRegion = meta.selectedRegion ?? { sido: '' };
    const sigungu = selectedRegion.sigungu;
    const pageSize = DEFAULT_PAGE_SIZE;
    const currentPage = meta.currentPage ?? 1;

    if (meta.stage === 'pfc3') {
      const installPlace = PFC3_INSTALL_PLACE_CODES[meta.pfc3InstallPlaceIndex] ?? null;
      if (!installPlace) {
        meta.stage = 'exfc5';
        meta.currentStage = 'exfc5';
        meta.currentInstallPlace = null;
        meta.currentPage = 1;
        meta.totalPages = null;
      } else {
        const page = await fetchPfc3WithMeta({
          inslPlcSeCd: installPlace,
          pageIndex: currentPage,
          recordCountPerPage: pageSize,
          pageNo: currentPage,
          numOfRows: pageSize,
        });

        const pageItems = page.items;
        const filteredRows = pageItems.filter((row) => matchesSelectedRegion(row, selectedRegion.sido, sigungu));
        const normalized = filteredRows.map((row) => toFacilityDoc(row, false));
        const deduped = dedupeByCoordinate(normalized).map((facility) => stripUndefinedDeep(facility));
        await upsertFacilities(deduped);

        const totalPages = page.meta.pageInfo.totalPageCnt ?? (page.meta.pageInfo.totalCount
          ? Math.ceil(page.meta.pageInfo.totalCount / (page.meta.pageInfo.recordCountPerPage ?? pageSize))
          : null);

        const reachedEnd = totalPages ? currentPage >= totalPages : pageItems.length < pageSize;

        meta.pagesFetched = (meta.pagesFetched ?? 0) + 1;
        meta.rawFacilityCount = (meta.rawFacilityCount ?? 0) + pageItems.length;
        meta.filteredFacilityCount = (meta.filteredFacilityCount ?? 0) + filteredRows.length;
        meta.successCount = (meta.successCount ?? 0) + deduped.length;
        meta.currentInstallPlace = installPlace;
        meta.totalPages = totalPages;

        if (reachedEnd) {
          meta.pfc3InstallPlaceIndex += 1;
          meta.currentPage = 1;
          if (meta.pfc3InstallPlaceIndex >= PFC3_INSTALL_PLACE_CODES.length) {
            meta.stage = 'exfc5';
            meta.currentStage = 'exfc5';
            meta.currentInstallPlace = null;
            meta.totalPages = null;
          } else {
            meta.currentInstallPlace = PFC3_INSTALL_PLACE_CODES[meta.pfc3InstallPlaceIndex];
          }
        } else {
          meta.currentPage = currentPage + 1;
        }
      }
    }

    if (meta.stage === 'exfc5') {
      const exfc5 = await fetchExfc5WithMeta({
        ctprvnNm: selectedRegion.sido,
        ...(sigungu ? { signguNm: sigungu } : {}),
        pageIndex: currentPage,
        recordCountPerPage: pageSize,
        pageNo: currentPage,
        numOfRows: pageSize,
      });

      const pagePfctSns = exfc5.items
        .filter((row) => matchesSelectedRegion(row, selectedRegion.sido, sigungu))
        .map((row) => Number(row.pfctSn))
        .filter((pfctSn) => Number.isFinite(pfctSn));

      const merged = new Set<number>([...(meta.excellentPfctSns ?? []), ...pagePfctSns]);
      meta.excellentPfctSns = [...merged];
      meta.pagesFetched = (meta.pagesFetched ?? 0) + 1;
      meta.totalPages = exfc5.meta.pageInfo.totalPageCnt ?? (exfc5.meta.pageInfo.totalCount
        ? Math.ceil(exfc5.meta.pageInfo.totalCount / (exfc5.meta.pageInfo.recordCountPerPage ?? pageSize))
        : null);

      const reachedEnd = meta.totalPages ? currentPage >= meta.totalPages : exfc5.items.length < pageSize;
      if (reachedEnd) {
        meta.stage = 'finalize';
        meta.currentStage = 'finalize';
        meta.currentPage = 1;
      } else {
        meta.currentPage = currentPage + 1;
      }
    }

    if (meta.stage === 'finalize') {
      const facilities = await getFacilitiesByRegion(selectedRegion.sido, sigungu);
      const excellentSet = new Set(meta.excellentPfctSns ?? []);
      const toUpdate = facilities
        .filter((facility) => excellentSet.has(facility.pfctSn) && !facility.isExcellent)
        .map((facility) => ({ ...facility, isExcellent: true, updatedAt: new Date().toISOString() }));
      await upsertFacilities(toUpdate);

      const startedAtMs = new Date(meta.startedAt ?? new Date().toISOString()).getTime();
      const buildDurationMs = Date.now() - startedAtMs;
      const updatedAt = new Date().toISOString();
      const finalMeta: RefreshRegionJobState = {
        ...meta,
        lastBuiltAt: updatedAt,
        updatedAt,
        status: 'success',
        done: true,
        lastBuildStatus: 'ok',
        lastError: null,
        currentStage: 'completed',
        currentInstallPlace: null,
        totalPages: meta.totalPages,
        facilitiesCount: facilities.length,
        excellentCount: facilities.filter((f) => excellentSet.has(f.pfctSn) || f.isExcellent).length,
        buildDurationMs,
      };
      await setCacheMeta(meta.regionKey, finalMeta);
      return finalMeta;
    }

    const updatedAt = new Date().toISOString();
    const nextMeta: RefreshRegionJobState = {
      ...meta,
      updatedAt,
      status: 'running',
      done: false,
      lastBuildStatus: 'ok',
      buildDurationMs: Date.now() - new Date(meta.startedAt ?? updatedAt).getTime(),
    };
    await setCacheMeta(meta.regionKey, nextMeta);
    return nextMeta;
  } catch (error) {
    await persistError(meta, error);
    throw error;
  }
}

export function mapJobError(error: unknown) {
  return jobErrorPayload(error);
}
