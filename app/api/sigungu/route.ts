import { NextRequest, NextResponse } from 'next/server';
import { fetchPfc3, PublicDataError } from '@/lib/public-data';
import { isMissingEnvError } from '@/lib/env';
import { getSigunguBySido } from '@/lib/firestore-repo';

export const runtime = 'nodejs';

function mapSigunguError(error: PublicDataError) {
  return {
    errorType: error.detail.type,
    status: error.detail.status ?? null,
    endpoint: error.detail.endpoint,
    attempts: error.detail.attempts ?? [],
    message: error.message,
  };
}

export async function GET(req: NextRequest) {
  const sido = req.nextUrl.searchParams.get('sido');
  if (!sido) return NextResponse.json({ message: 'sido is required' }, { status: 400 });

  try {
    const fromCache = await getSigunguBySido(sido);
    if (fromCache.length > 0) {
      return NextResponse.json({ sigungu: fromCache, source: 'firestore' });
    }

    const pfc3 = await fetchPfc3({ ctprvnNm: sido, numOfRows: 10000 });
    const sigungu = [...new Set(pfc3.map((row) => String(row.signguNm ?? '')).filter(Boolean))].sort();
    if (sigungu.length === 0) {
      return NextResponse.json({
        sigungu: [],
        source: 'public-api',
        errorType: 'empty-result',
        message: '선택한 시/도의 시군구 데이터를 찾지 못했습니다.',
      });
    }
    return NextResponse.json({ sigungu, source: 'public-api' });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return NextResponse.json({ message: error.message, sigungu: [] }, { status: 500 });
    }
    if (error instanceof PublicDataError) {
      return NextResponse.json({ sigungu: [], ...mapSigunguError(error) }, { status: 502 });
    }
    return NextResponse.json({ message: 'sigungu lookup failed', sigungu: [], errorType: 'unknown' }, { status: 500 });
  }
}
