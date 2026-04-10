import { jsonError } from '@/lib/admin-json';
export const runtime = 'nodejs';
export async function POST() {
  return jsonError('manual upload is disabled. use baseline background job.', { status: 410 });
}
