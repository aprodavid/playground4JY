import { BASELINE_META_KEY, getUploadRows, rebuildSigunguIndexFromFacilities, replaceFacilities, setCacheMeta } from './firestore-repo';
import { dedupeByCoordinate, extractRegionFromRaw, normalizeSido, toFacilityDoc } from './normalization';
import { KOREA_SIDO_LIST, type FacilityDoc } from '@/types/domain';

const VALID_SIDO = new Set<string>(KOREA_SIDO_LIST);

function pfctSnFrom(row: Record<string, unknown>) {
  const raw = row.pfctSn ?? row.pfct_sn ?? row['시설일련번호'] ?? row['시설번호'];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function runBaselineImport() {
  const startedAt = new Date();
  const nowIso = startedAt.toISOString();

  await setCacheMeta(BASELINE_META_KEY, {
    regionKey: BASELINE_META_KEY,
    baselineStatus: 'running',
    baselineSource: 'file-import',
    baselineStartedAt: nowIso,
    baselineUpdatedAt: nowIso,
    baselineLastError: null,
    baselineCurrentStage: 'validating-upload',
    baselineImportProgress: { total: 0, processed: 0, success: 0, failure: 0 },
    status: 'running',
    done: false,
    currentStage: 'file-import',
    lastBuildStatus: 'ok',
    lastBuiltAt: nowIso,
    facilitiesCount: 0,
    excellentCount: 0,
  });

  const [pfc3Rows, exfc5Rows] = await Promise.all([getUploadRows('pfc3'), getUploadRows('exfc5')]);
  if (pfc3Rows.length === 0 || exfc5Rows.length === 0) {
    throw new Error('pfc3/exfc5 업로드 파일이 모두 필요합니다. 운영 패널에서 파일 업로드 후 다시 실행하세요.');
  }

  const excellentSet = new Set<number>(
    exfc5Rows
      .map((row) => pfctSnFrom(row))
      .filter((v): v is number => typeof v === 'number'),
  );

  const normalized: FacilityDoc[] = [];
  const unmatchedReasonCount: Record<string, number> = {};
  const sampleRegions = new Set<string>();

  const markReason = (reason: string) => {
    unmatchedReasonCount[reason] = (unmatchedReasonCount[reason] ?? 0) + 1;
  };

  for (let i = 0; i < pfc3Rows.length; i += 1) {
    const row = pfc3Rows[i];
    const pfctSn = pfctSnFrom(row);
    if (!pfctSn) {
      markReason('invalid-pfctSn');
      continue;
    }

    const region = extractRegionFromRaw(row);
    const normalizedSido = normalizeSido(region.sido);
    if (!normalizedSido || !VALID_SIDO.has(normalizedSido)) {
      markReason('missing-or-unknown-sido');
      continue;
    }

    const doc = toFacilityDoc({ ...row, pfctSn, sido: normalizedSido, sigungu: region.sigungu, address: region.address }, excellentSet.has(pfctSn));
    if (!doc.sido) {
      markReason('normalized-sido-empty');
      continue;
    }

    if (sampleRegions.size < 10) sampleRegions.add(`${doc.sido} ${doc.sigungu || '(sigungu-empty)'}`);
    normalized.push(doc);

    if (i % 200 === 0) {
      await setCacheMeta(BASELINE_META_KEY, {
        baselineCurrentStage: 'normalizing-facilities',
        baselineUpdatedAt: new Date().toISOString(),
        baselineImportProgress: {
          total: pfc3Rows.length,
          processed: i + 1,
          success: normalized.length,
          failure: i + 1 - normalized.length,
        },
      });
    }
  }

  const deduped = dedupeByCoordinate(normalized);
  await setCacheMeta(BASELINE_META_KEY, {
    baselineCurrentStage: 'writing-firestore',
    baselineUpdatedAt: new Date().toISOString(),
    baselineRawFacilityCount: pfc3Rows.length,
    baselineFilteredFacilityCount: deduped.length,
    baselineSampleMatchedRegions: [...sampleRegions],
    baselineUnmatchedReasonCount: unmatchedReasonCount,
    baselineImportProgress: {
      total: pfc3Rows.length,
      processed: pfc3Rows.length,
      success: deduped.length,
      failure: pfc3Rows.length - deduped.length,
    },
  });

  await replaceFacilities(deduped);
  await rebuildSigunguIndexFromFacilities();

  const finishedAt = new Date();
  const finishedIso = finishedAt.toISOString();
  await setCacheMeta(BASELINE_META_KEY, {
    baselineStatus: 'success',
    baselineSource: 'file-import',
    baselineCurrentStage: 'completed',
    baselineUpdatedAt: finishedIso,
    baselineLastError: null,
    status: 'success',
    done: true,
    lastBuildStatus: 'ok',
    lastBuiltAt: finishedIso,
    updatedAt: finishedIso,
    buildDurationMs: finishedAt.getTime() - startedAt.getTime(),
    facilitiesCount: deduped.length,
    excellentCount: deduped.filter((x) => x.isExcellent).length,
    baselinePagesFetched: 0,
  });

  return {
    imported: deduped.length,
    excellentCount: deduped.filter((x) => x.isExcellent).length,
    rawCount: pfc3Rows.length,
  };
}
