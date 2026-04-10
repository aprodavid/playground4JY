import { NextRequest, NextResponse } from 'next/server';
import { BASELINE_META_KEY, getCacheMeta, getSigunguBySido } from '@/lib/firestore-repo';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sido = req.nextUrl.searchParams.get('sido');
  if (!sido) return NextResponse.json({ message: 'sido is required' }, { status: 400 });

  try {
    const baselineMeta = await getCacheMeta(BASELINE_META_KEY);
    if (!baselineMeta || baselineMeta.baselineStatus !== 'success') {
      return NextResponse.json({
        sigungu: [],
        source: 'none',
        emptyReason: baselineMeta?.baselineStatus === 'running' ? 'baseline-running' : 'baseline-not-ready',
        message: '시군구 목록은 기준선 캐시 빌드 후에 사용할 수 있습니다.',
      }, { status: 409 });
    }

    const fromCache = await getSigunguBySido(sido);
    if (fromCache.length === 0) {
      return NextResponse.json({
        sigungu: [],
        source: 'sigungu-index',
        emptyReason: 'sido-match-zero',
        message: '기준선 캐시에는 해당 시/도의 시군구 데이터가 없습니다.',
      });
    }

    return NextResponse.json({ sigungu: fromCache, source: 'sigungu-index' });
  } catch (error) {
    return NextResponse.json({ message: 'sigungu lookup failed', sigungu: [], errorType: 'unknown', detailMessage: error instanceof Error ? error.message : 'unknown error' }, { status: 500 });
  }
}
