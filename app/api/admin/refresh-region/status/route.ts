import { GET as getImportStatus } from '@/app/api/admin/baseline-import/status/route';

export const runtime = 'nodejs';

export async function GET() {
  return getImportStatus();
}
