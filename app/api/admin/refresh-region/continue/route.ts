import { jsonOk } from '@/lib/admin-json';

export const runtime = 'nodejs';

export async function POST() {
  return jsonOk({
    message: '기준선 작업은 Firebase Functions 스케줄러가 자동으로 이어서 처리합니다.',
    done: true,
  });
}
