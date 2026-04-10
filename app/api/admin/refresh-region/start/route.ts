import { POST as startImport } from '@/app/api/admin/baseline-import/start/route';

export const runtime = 'nodejs';

export async function POST() {
  return startImport();
}
