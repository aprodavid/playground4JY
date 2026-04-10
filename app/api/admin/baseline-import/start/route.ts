import { createJob, getLatestJob } from '@/lib/firestore-repo';
import { jsonError, jsonOk } from '@/lib/admin-json';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const existing = await getLatestJob('baseline');
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
      return jsonOk({ message: 'baseline job already running', job: existing }, 409);
    }
    const job = await createJob('baseline');
    return jsonOk({ message: 'baseline job queued', job }, 201);
  } catch (error) {
    return jsonError('baseline start failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
