import { NextResponse } from 'next/server';
import { z } from 'zod';
import { INSTALL_PLACE_CODES } from '@/src/config/installPlaces';
import { DEFAULT_WEIGHTS } from '@/src/config/uiDefaults';
import { isMissingEnvError } from '@/lib/env';
import { getBaselineMeta, getFacilitiesByRegion, getRideCaches } from '@/lib/firestore-repo';
import { scoreFacility } from '@/lib/scoring';

const schema = z.object({
  sido: z.string().min(1),
  sigungu: z.string().min(1).optional(),
  installPlaces: z.array(z.enum(INSTALL_PLACE_CODES)).min(1),
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

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
    const { sido, sigungu, installPlaces, installYearFrom, topN, weights } = parsed.data;

    const baselineMeta = await getBaselineMeta(sido);
    if (!baselineMeta || !baselineMeta.baselineReady || baselineMeta.status !== 'success') {
      return NextResponse.json({
        summary: { totalCandidates: 0, recommended: 0 },
        excellentFacilities: [],
        topResults: [],
        nearMissResults: [],
        emptyReason: baselineMeta?.status === 'running' ? 'baseline-progressing' : 'baseline-not-ready',
        needsCacheBuild: true,
        message: '해당 시도의 기준선 캐시가 필요합니다. 운영 패널에서 선택 시도를 기준으로 baseline을 생성해주세요.',
      }, { status: 409 });
    }

    const regional = await getFacilitiesByRegion(sido, sigungu);
    const facilities = regional
      .filter((f) => installPlaces.includes(f.installPlaceCode))
      .filter((f) => (installYearFrom ? (f.installYear ?? 0) >= installYearFrom : true));

    if (!facilities.length) {
      return NextResponse.json({
        summary: { totalCandidates: 0, recommended: 0 },
        excellentFacilities: [],
        topResults: [],
        nearMissResults: [],
        emptyReason: 'filter-match-zero',
        message: '선택한 조건과 일치하는 baseline 시설이 없습니다.',
      });
    }

    const rideCached = await getRideCaches(facilities.map((f) => f.pfctSn));
    const rideMap = new Map(rideCached.map((r) => [r.pfctSn, r]));
    const ws = weights ?? DEFAULT_WEIGHTS;

    const scored = facilities.map((f) => scoreFacility(f, rideMap.get(f.pfctSn) ?? {
      pfctSn: f.pfctSn, rawCount: 0, filteredCount: 0, typeCount: 0, types: [], updatedAt: '', status: 'empty',
    }, ws)).sort((a, b) => b.score - a.score);

    return NextResponse.json({
      summary: { totalCandidates: scored.length, recommended: scored.filter((x) => x.recommended).length },
      excellentFacilities: scored.filter((x) => x.isExcellent).slice(0, 20),
      topResults: scored.slice(0, topN),
      nearMissResults: scored.slice(topN, topN + 5),
      needsCacheBuild: false,
    });
  } catch (error) {
    if (isMissingEnvError(error)) return NextResponse.json({ message: error.message }, { status: 500 });
    return NextResponse.json({ message: 'search failed', detailMessage: error instanceof Error ? error.message : 'unknown error' }, { status: 500 });
  }
}
