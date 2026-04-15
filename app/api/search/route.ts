import { NextResponse } from 'next/server';
import { z } from 'zod';
import { INSTALL_PLACE_CODES } from '@/src/config/installPlaces';
import { DEFAULT_WEIGHTS } from '@/src/config/uiDefaults';
import { BASELINE_META_KEY } from '@/src/config/firestore';
import { isMissingEnvError } from '@/lib/env';
import { getCacheMeta, getFacilitiesByRegion, getRideCaches } from '@/lib/firestore-repo';
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

    const baselineMeta = await getCacheMeta(BASELINE_META_KEY);
    if (!baselineMeta || !baselineMeta.baselineReady || baselineMeta.baselineStatus !== 'success') {
      const reason = baselineMeta?.baselineStatus === 'running' ? 'baseline-progressing' : 'baseline-not-ready';
      return NextResponse.json({
        summary: { totalCandidates: 0, recommended: 0 },
        excellentSection: [], top: [], nearMiss: [],
        emptyReason: reason,
        needsCacheBuild: true,
        message: 'baseline 캐시가 준비되지 않았습니다. 운영 패널에서 기준선 캐시 생성/완료 후 다시 검색해주세요.',
      }, { status: 409 });
    }

    const regional = await getFacilitiesByRegion(sido, sigungu);
    if (!regional.length) {
      return NextResponse.json({ summary: { totalCandidates: 0, recommended: 0 }, excellentSection: [], top: [], nearMiss: [], emptyReason: sigungu ? 'sigungu-match-zero' : 'sido-match-zero', message: '선택한 지역 조건에 맞는 baseline 시설이 없습니다.' });
    }

    const facilities = regional
      .filter((f) => installPlaces.includes(f.installPlaceCode))
      .filter((f) => (installYearFrom ? (f.installYear ?? 0) >= installYearFrom : true));

    if (!facilities.length) {
      return NextResponse.json({ summary: { totalCandidates: 0, recommended: 0 }, excellentSection: [], top: [], nearMiss: [], emptyReason: 'sigungu-field-missing', message: '기준선은 있으나 필터 조건(설치장소/설치연도)에 맞는 시설이 없습니다.' });
    }

    const rideCached = await getRideCaches(facilities.map((f) => f.pfctSn));
    const rideMap = new Map(rideCached.map((r) => [r.pfctSn, r]));
    const ws = weights ?? DEFAULT_WEIGHTS;

    const scored = facilities.map((f) => scoreFacility(f, rideMap.get(f.pfctSn) ?? {
      pfctSn: f.pfctSn, rawCount: 0, filteredCount: 0, typeCount: 0, types: [], updatedAt: '', status: 'empty',
    }, ws)).sort((a, b) => b.score - a.score);

    return NextResponse.json({
      summary: { totalCandidates: scored.length, recommended: scored.filter((x) => x.recommended).length },
      excellentSection: scored.filter((x) => x.isExcellent).slice(0, 20),
      top: scored.slice(0, topN),
      nearMiss: scored.slice(topN, topN + 5),
      needsCacheBuild: false,
    });
  } catch (error) {
    if (isMissingEnvError(error)) return NextResponse.json({ message: error.message }, { status: 500 });
    return NextResponse.json({ message: 'search failed', detailMessage: error instanceof Error ? error.message : 'unknown error' }, { status: 500 });
  }
}
