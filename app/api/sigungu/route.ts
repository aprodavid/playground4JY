import { NextRequest, NextResponse } from 'next/server';
import { fetchPfc3 } from '@/lib/public-data';
import { isMissingEnvError } from '@/lib/env';
import { getSigunguBySido } from '@/lib/firestore-repo';

export const runtime = 'nodejs';

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
      return NextResponse.json({ sigungu: [], source: 'public-api', message: '선택한 시/도의 시군구 데이터를 찾지 못했습니다.' });
    }
    return NextResponse.json({ sigungu, source: 'public-api' });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return NextResponse.json({ message: error.message, sigungu: [] }, { status: 500 });
    }
    return NextResponse.json({ message: 'sigungu lookup failed', sigungu: [] }, { status: 500 });
  }
}
