import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_WEIGHTS, type InstallPlaceCode } from '@/types/domain';
import { isMissingEnvError } from '@/lib/env';
import { BASELINE_META_KEY, getCacheMeta, getFacilitiesByRegion, getRideCaches, upsertRideCache } from '@/lib/firestore-repo';
import { scoreFacility } from '@/lib/scoring';
import { fetchRide4, PublicDataError } from '@/lib/public-data';
import { RIDE_WHITELIST } from '@/types/domain';

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

async function buildRideCache(pfctSn: number) {
  try {
    const rides = await fetchRide4(pfctSn);
    const filtered = rides.filter((r) => RIDE_WHITELIST.includes(String(r.playkndCd) as never));
    const types = [...new Set(filtered.map((r) => String(r.playkndCd)))];
    const doc: import('@/types/domain').RideCacheDoc = {
      pfctSn,
      rawCount: rides.length,
      filteredCount: filtered.length,
      typeCount: types.length,
      types,
      updatedAt: new Date().toISOString(),
      status: filtered.length > 0 ? 'ok' : 'empty' as const,
    };
    await upsertRideCache(doc);
    return doc;
  } catch (error) {
    const doc: import('@/types/domain').RideCacheDoc = {
      pfctSn,
      rawCount: 0,
      filteredCount: 0,
      typeCount: 0,
      types: [],
      updatedAt: new Date().toISOString(),
      status: 'error' as const,
      lastError: error instanceof Error ? error.message : 'unknown error',
    };
    await upsertRideCache(doc);
    return doc;
  }
}

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });

    const { sido, sigungu, installPlaces, installYearFrom, topN, weights } = parsed.data;
    const ws = weights ?? DEFAULT_WEIGHTS;

    const baselineMeta = await getCacheMeta(BASELINE_META_KEY);
    if (!baselineMeta || baselineMeta.baselineStatus !== 'success') {
      return NextResponse.json({
        summary: { totalCandidates: 0, recommended: 0 },
        excellentSection: [],
        top: [],
        nearMiss: [],
        needsCacheBuild: true,
        message: '시설 기준선 캐시가 준비되지 않았습니다. 운영 패널에서 "기준선 캐시 빌드"를 먼저 실행하세요.',
        emptyReason: baselineMeta?.baselineStatus === 'running' ? 'baseline-running' : 'baseline-not-ready',
      }, { status: 409 });
    }

    let facilities = await getFacilitiesByRegion(sido, sigungu);

    if (facilities.length === 0) {
      return NextResponse.json({
        summary: { totalCandidates: 0, recommended: 0 },
        excellentSection: [],
        top: [],
        nearMiss: [],
        needsCacheBuild: false,
        emptyReason: sigungu ? 'region-match-zero' : 'sido-match-zero',
        message: '기준선 캐시는 존재하지만 선택한 지역에 매칭되는 시설이 없습니다. 지역 필터를 확인하세요.',
      });
    }

    facilities = facilities
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

    return NextResponse.json({
      summary: { totalCandidates: scored.length, recommended: recommended.length },
      excellentSection: scored.filter((x) => x.isExcellent).slice(0, 20),
      top: scored.slice(0, topN),
      nearMiss: scored.slice(topN, topN + 5),
      needsCacheBuild: false,
    });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    if (error instanceof PublicDataError) {
      return NextResponse.json({
        message: 'search failed',
        errorType: error.detail.type,
        status: error.detail.status ?? null,
        endpoint: error.detail.endpoint,
        attempts: error.detail.attempts ?? [],
        detailMessage: error.message,
      }, { status: 502 });
    }
    return NextResponse.json({ message: 'search failed' }, { status: 500 });
  }
}
