import { isMissingEnvError } from '@/lib/env';
import { jsonError, jsonOk } from '@/lib/admin-json';
import { continueRefreshRegionJob, getRefreshRegionJob, mapJobError } from '@/lib/refresh-region-job';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const current = await getRefreshRegionJob();
    if (!current) {
      return jsonError('baseline facilities build not found', { status: 404, errorType: 'not-found' });
    }

    const next = await continueRefreshRegionJob(current);
    return jsonOk({
      message: next.done ? 'baseline facilities build completed' : 'baseline facilities build continued',
      regionKey: next.regionKey,
      jobId: next.jobId,
      status: next.status,
      currentStage: next.currentStage,
      currentInstallPlace: next.currentInstallPlace,
      currentPage: next.currentPage,
      totalPages: next.totalPages ?? null,
      baselineStatus: next.baselineStatus,
      baselinePagesFetched: next.baselinePagesFetched,
      baselineRawFacilityCount: next.baselineRawFacilityCount,
      baselineFilteredFacilityCount: next.baselineFilteredFacilityCount,
      baselineLastError: next.baselineLastError ?? null,
      baselineSampleMatchedRegions: next.baselineSampleMatchedRegions ?? [],
      baselineUnmatchedReasonCount: next.baselineUnmatchedReasonCount ?? {},
      done: next.done,
      startedAt: next.startedAt,
      updatedAt: next.updatedAt,
      buildDurationMs: next.buildDurationMs ?? null,
      facilitiesCount: next.facilitiesCount,
      excellentCount: next.excellentCount,
    });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return jsonError(error.message, { status: 500, errorType: 'missing-env' });
    }
    const mapped = mapJobError(error);
    return jsonError(mapped.message, {
      status: mapped.errorType === 'status' || mapped.errorType === 'parse' || mapped.errorType === 'auth' ? 502 : 500,
      errorType: mapped.errorType,
      detailMessage: mapped.detailMessage,
      endpoint: mapped.endpoint,
    });
  }
}
