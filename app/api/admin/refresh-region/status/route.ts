import { jsonError, jsonOk } from '@/lib/admin-json';
import { getRefreshRegionJob } from '@/lib/refresh-region-job';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const job = await getRefreshRegionJob();

    if (!job) {
      return jsonError('baseline facilities build status not found', { status: 404, errorType: 'not-found' });
    }

    return jsonOk({
      regionKey: job.regionKey,
      jobId: job.jobId,
      status: job.status,
      currentStage: job.currentStage,
      currentInstallPlace: job.currentInstallPlace,
      currentPage: job.currentPage,
      totalPages: job.totalPages ?? null,
      baselineStatus: job.baselineStatus,
      baselinePagesFetched: job.baselinePagesFetched,
      baselineRawFacilityCount: job.baselineRawFacilityCount,
      baselineFilteredFacilityCount: job.baselineFilteredFacilityCount,
      baselineLastError: job.baselineLastError ?? null,
      baselineSampleMatchedRegions: job.baselineSampleMatchedRegions ?? [],
      baselineUnmatchedReasonCount: job.baselineUnmatchedReasonCount ?? {},
      done: job.done,
      stopRequested: job.stopRequested ?? false,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      buildDurationMs: job.buildDurationMs ?? null,
      facilitiesCount: job.facilitiesCount,
      excellentCount: job.excellentCount,
      rideStatus: job.rideStatus ?? 'idle',
      rideProgress: job.rideProgress ?? null,
      rideLastError: job.rideLastError ?? null,
    });
  } catch (error) {
    return jsonError('baseline facilities build status failed', {
      status: 500,
      errorType: 'unknown',
      detailMessage: error instanceof Error ? error.message : 'unknown error',
    });
  }
}
