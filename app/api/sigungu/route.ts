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
        source: 'sigungu-index',
        emptyReason: baselineMeta?.baselineStatus === 'running' ? 'baseline-running' : 'baseline-not-ready',
        message: '시군구 목록은 baseline 완료 후 sigunguIndex에서만 조회됩니다.',
      }, { status: 409 });
    }

    const fromIndex = await getSigunguBySido(sido);
    if (fromIndex.length === 0) {
      return NextResponse.json({
        sigungu: [],
        source: 'sigungu-index',
        emptyReason: 'sido-match-zero',
        message: 'sigunguIndex에 해당 시/도 데이터가 없습니다.',
      });
    }

    return NextResponse.json({ sigungu: fromIndex, source: 'sigungu-index' });
  } catch (error) {
    return NextResponse.json({
      message: 'sigungu lookup failed',
      sigungu: [],
      errorType: 'unknown',
      detailMessage: error instanceof Error ? error.message : 'unknown error',
    }, { status: 500 });
  }
}
