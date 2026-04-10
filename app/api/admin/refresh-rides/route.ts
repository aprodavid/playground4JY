import { z } from 'zod';
import { getFacilitiesByRegion } from '@/lib/firestore-repo';
import { fetchRide4, PublicDataError } from '@/lib/public-data';
import { upsertRideCache } from '@/lib/firestore-repo';
import { isMissingEnvError } from '@/lib/env';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/admin-json';
import { RIDE_WHITELIST } from '@/types/domain';

const schema = z.object({ sido: z.string().min(1), sigungu: z.string().optional(), limit: z.number().int().min(1).max(300).default(100) });
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await parseJsonBody(req));
    if (!parsed.success) return jsonOk({ message: 'invalid payload', errorType: 'validation', errors: parsed.error.flatten() }, 400);
    const { sido, sigungu, limit } = parsed.data;

    const facilities = await getFacilitiesByRegion(sido, sigungu);
    if (facilities.length === 0) {
      return jsonOk({ message: '시설 캐시가 없어 ride 캐시를 갱신할 수 없습니다. 먼저 지역 캐시를 빌드하세요.', tried: 0, updated: 0 }, 400);
    }

    const target = facilities.slice(0, limit);
    let updated = 0;

    for (const f of target) {
      try {
        const rides = await fetchRide4(f.pfctSn);
        const filtered = rides.filter((r) => RIDE_WHITELIST.includes(String(r.playkndCd) as never));
        const types = [...new Set(filtered.map((r) => String(r.playkndCd)))];
        await upsertRideCache({
          pfctSn: f.pfctSn,
          rawCount: rides.length,
          filteredCount: filtered.length,
          typeCount: types.length,
          types,
          updatedAt: new Date().toISOString(),
          status: 'ok',
        });
        updated += 1;
      } catch (error) {
        await upsertRideCache({
          pfctSn: f.pfctSn,
          rawCount: 0,
          filteredCount: 0,
          typeCount: 0,
          types: [],
          updatedAt: new Date().toISOString(),
          status: 'error',
          lastError: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    return jsonOk({ tried: target.length, updated, message: `ride 캐시 ${updated}건 갱신 완료` });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return jsonError(error.message, { status: 500, errorType: 'missing-env' });
    }
    if (error instanceof PublicDataError) {
      return jsonError('refresh-rides failed', {
        status: 502,
        errorType: error.detail.type,
        detailMessage: error.message,
        endpoint: error.detail.endpoint,
        extra: { status: error.detail.status ?? null, attempts: error.detail.attempts ?? [] },
      });
    }
    return jsonError('refresh-rides failed', { status: 500, errorType: 'unknown', detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
