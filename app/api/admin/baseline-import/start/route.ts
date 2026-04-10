import { jsonError, jsonOk } from '@/lib/admin-json';
import { runBaselineImport } from '@/lib/baseline-import';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const result = await runBaselineImport();
    return jsonOk({ message: '파일 import 기준선 생성이 완료되었습니다.', ...result, done: true });
  } catch (error) {
    return jsonError('baseline import failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
