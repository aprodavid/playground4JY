import { jsonOk } from '@/lib/admin-json';

export const runtime = 'nodejs';

export async function POST() {
  return jsonOk({ message: '파일 import 기준선 생성은 즉시 처리되어 중지 기능이 비활성화되었습니다.', done: true });
}
