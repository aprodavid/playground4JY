import { POST as startRefreshRegion } from '@/app/api/admin/refresh-region/start/route';

export const runtime = 'nodejs';

export async function POST() {
  return startRefreshRegion();
}
