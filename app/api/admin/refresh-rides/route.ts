import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getFacilitiesByRegion } from '@/lib/firestore-repo';
import { fetchRide4 } from '@/lib/public-data';
import { upsertRideCache } from '@/lib/firestore-repo';
import { isMissingEnvError } from '@/lib/env';
import { RIDE_WHITELIST } from '@/types/domain';

const schema = z.object({ sido: z.string().min(1), sigungu: z.string().optional(), limit: z.number().int().min(1).max(300).default(100) });
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
    const { sido, sigungu, limit } = parsed.data;

    const facilities = await getFacilitiesByRegion(sido, sigungu);
    if (facilities.length === 0) {
      return NextResponse.json({ message: '시설 캐시가 없어 ride 캐시를 갱신할 수 없습니다. 먼저 지역 캐시를 빌드하세요.', tried: 0, updated: 0 }, { status: 400 });
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

    return NextResponse.json({ tried: target.length, updated, message: `ride 캐시 ${updated}건 갱신 완료` });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    return NextResponse.json({ message: 'refresh-rides failed' }, { status: 500 });
  }
}
