import { getLatestJob, requestStopJob } from '@/lib/firestore-repo';
import { jsonError, jsonOk } from '@/lib/admin-json';

export const runtime = 'nodejs';

export async function POST() {
  const latest = await getLatestJob('baseline');
  if (!latest) return jsonError('no baseline job found', { status: 404 });
  await requestStopJob(latest.jobId);
  return jsonOk({ message: 'stop requested', jobId: latest.jobId });
}
