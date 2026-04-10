import { jsonError, jsonOk } from '@/lib/admin-json';
import { requestStopRefreshRegionJob } from '@/lib/refresh-region-job';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const requested = await requestStopRefreshRegionJob();
    if (!requested) return jsonError('baseline facilities build not found', { status: 404, errorType: 'not-found' });
    return jsonOk({ message: 'baseline facilities build stop requested' });
  } catch (error) {
    return jsonError('failed to request baseline stop', {
      status: 500,
      errorType: 'unknown',
      detailMessage: error instanceof Error ? error.message : 'unknown error',
    });
  }
}
