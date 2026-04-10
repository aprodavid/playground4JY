import { getLatestJob } from '@/lib/firestore-repo';
import { jsonError, jsonOk } from '@/lib/admin-json';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const job = await getLatestJob('baseline');
    return jsonOk({ job });
  } catch (error) {
    return jsonError('baseline job status failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
