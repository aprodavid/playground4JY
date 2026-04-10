import { jsonOk } from '@/lib/admin-json';

export const runtime = 'nodejs';

export async function POST() {
  return jsonOk({
    message: '기준선 생성은 파일 import 일괄 처리로 전환되어 continue 단계가 필요 없습니다.',
    done: true,
  });
}
