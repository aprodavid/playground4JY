import { isMissingEnvError } from '@/lib/env';
import { jsonError, jsonOk } from '@/lib/admin-json';
import { initRefreshRegionJob, mapJobError } from '@/lib/refresh-region-job';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const job = await initRefreshRegionJob();
    return jsonOk({
      message: 'baseline facilities build started',
      regionKey: job.regionKey,
      jobId: job.jobId,
      status: job.status,
      currentStage: job.currentStage,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      done: job.done,
    });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return jsonError(error.message, { status: 500, errorType: 'missing-env' });
    }
    const mapped = mapJobError(error);
    return jsonError(mapped.message, { status: 500, errorType: mapped.errorType, detailMessage: mapped.detailMessage, endpoint: mapped.endpoint });
  }
}
