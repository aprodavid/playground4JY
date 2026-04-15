import { NextRequest, NextResponse } from 'next/server';
import { getBaselineMeta, getSigunguBySido } from '@/lib/firestore-repo';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sido = req.nextUrl.searchParams.get('sido');
  if (!sido) return NextResponse.json({ message: 'sido is required' }, { status: 400 });

  try {
    const baselineMeta = await getBaselineMeta(sido);
    if (!baselineMeta || baselineMeta.status !== 'success' || !baselineMeta.baselineReady) {
      return NextResponse.json({
        sigungu: [],
        source: 'sigungu-index',
        emptyReason: baselineMeta?.status === 'running' ? 'baseline-running' : 'baseline-not-ready',
        message: '해당 시도의 기준선 캐시가 필요합니다.',
      }, { status: 409 });
    }

    const fromIndex = await getSigunguBySido(sido);
    return NextResponse.json({ sigungu: fromIndex, source: 'sigungu-index' });
  } catch (error) {
    return NextResponse.json({
      message: 'sigungu lookup failed',
      sigungu: [],
      detailMessage: error instanceof Error ? error.message : 'unknown error',
    }, { status: 500 });
  }
}
