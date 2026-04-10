import { POST as startJob } from '@/app/api/admin/jobs/start/route';

export const runtime = 'nodejs';

export async function POST() {
  return startJob(new Request('http://localhost/api/admin/jobs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'baseline' }),
  }));
}
