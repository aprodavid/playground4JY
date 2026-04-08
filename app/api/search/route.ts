import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_WEIGHTS, RIDE_WHITELIST, type InstallPlaceCode, type RideCacheDoc } from '@/types/domain';
import { fetchRide4 } from '@/lib/public-data';
import { isMissingEnvError } from '@/lib/env';
import { getFacilitiesByRegion, getRideCaches, upsertRideCache } from '@/lib/firestore-repo';
import { scoreFacility } from '@/lib/scoring';

const schema = z.object({
  sido: z.string().min(1),
  sigungu: z.string().min(1).optional(),
  installPlaces: z.array(z.enum(['A003', 'A022', 'A033'])).min(1),
  installYearFrom: z.number().int().min(1900).optional(),
  topN: z.number().int().min(1).max(50).default(10),
  weights: z.object({
    recent3yBonus: z.number(), recent5yBonus: z.number(),
    area300: z.number(), area600: z.number(), area1000: z.number(),
    type3: z.number(), type4: z.number(), type6: z.number(),
    ride5: z.number(), ride8: z.number(), excellentBonus: z.number(),
  }).optional(),
});
export const runtime = 'nodejs';

async function buildRideCache(pfctSn: number): Promise<RideCacheDoc> {
  try {
    const rides = await fetchRide4(pfctSn);
    const rawCount = rides.length;
    const filtered = rides.filter((r) => RIDE_WHITELIST.includes(String(r.playkndCd) as never));
    const types = [...new Set(filtered.map((r) => String(r.playkndCd)))];
    const doc: RideCacheDoc = {
      pfctSn,
      rawCount,
      filteredCount: filtered.length,
      typeCount: types.length,
      types,
      updatedAt: new Date().toISOString(),
      status: filtered.length > 0 ? 'ok' : 'empty',
    };
    await upsertRideCache(doc);
    return doc;
  } catch (error) {
    const doc: RideCacheDoc = {
      pfctSn,
      rawCount: 0,
      filteredCount: 0,
      typeCount: 0,
      types: [],
      updatedAt: new Date().toISOString(),
      status: 'error',
      lastError: error instanceof Error ? error.message : 'unknown error',
    };
    await upsertRideCache(doc);
    return doc;
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });

    const { sido, sigungu, installPlaces, installYearFrom, topN, weights } = parsed.data;
    const ws = weights ?? DEFAULT_WEIGHTS;

    const facilities = (await getFacilitiesByRegion(sido, sigungu))
      .filter((f) => installPlaces.includes(f.installPlaceCode as InstallPlaceCode))
      .filter((f) => (installYearFrom ? (f.installYear ?? 0) >= installYearFrom : true));

    const rideCached = await getRideCaches(facilities.map((f) => f.pfctSn));
    const rideMap = new Map(rideCached.map((r) => [r.pfctSn, r]));

    const missing = facilities.filter((f) => !rideMap.has(f.pfctSn));
    const priority = missing.sort((a, b) => (b.isExcellent ? 1 : 0) - (a.isExcellent ? 1 : 0)).slice(0, 40);
    for (const f of priority) {
      const cache = await buildRideCache(f.pfctSn);
      rideMap.set(f.pfctSn, cache);
    }

    const scored = facilities
      .map((f) => scoreFacility(f, rideMap.get(f.pfctSn) ?? {
        pfctSn: f.pfctSn, rawCount: 0, filteredCount: 0, typeCount: 0, types: [], updatedAt: '', status: 'empty',
      }, ws))
      .sort((a, b) => b.score - a.score);

    const recommended = scored.filter((x) => x.recommended);
    const top = scored.slice(0, topN);
    const nearMiss = scored.slice(topN, topN + 5);

    return NextResponse.json({
      summary: { totalCandidates: scored.length, recommended: recommended.length },
      excellentSection: scored.filter((x) => x.isExcellent).slice(0, 20),
      top,
      nearMiss,
    });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    return NextResponse.json({ message: 'search failed' }, { status: 500 });
  }
}
