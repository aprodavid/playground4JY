import { BASELINE_META_KEY, getCacheMeta, getLatestJob } from '@/lib/firestore-repo';
import { jsonError, jsonOk } from '@/lib/admin-json';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const [baselineMeta, job] = await Promise.all([
      getCacheMeta(BASELINE_META_KEY),
      getLatestJob('baseline'),
    ]);
    return jsonOk({ baselineMeta, job });
  } catch (error) {
    return jsonError('baseline status failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
