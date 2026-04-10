import { NextRequest, NextResponse } from 'next/server';
import { fetchPfc3AcrossInstallPlaces, PublicDataError } from '@/lib/public-data';
import { isMissingEnvError } from '@/lib/env';
import { extractRegionFromRaw } from '@/lib/normalization';
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

    const pfc3 = await fetchPfc3AcrossInstallPlaces({ pageSize: 500 });
    const matchedSido = pfc3.items.filter((row) => extractRegionFromRaw(row).sido === sido);
    const sigungu = [...new Set(matchedSido.map((row) => extractRegionFromRaw(row).sigungu).filter(Boolean))].sort();

    if (sigungu.length === 0) {
      const reason = matchedSido.length === 0
        ? `pfc3 전체 ${pfc3.items.length}건에서 ${sido}로 매칭된 데이터가 없습니다.`
        : `${sido} 데이터 ${matchedSido.length}건은 존재하지만 시/군/구 필드(signguNm/sigunguNm/sggNm/address)가 비어 있습니다.`;

      return NextResponse.json({
        sigungu: [],
        source: 'public-api',
        errorType: 'empty-result',
        message: `선택한 시/도의 시군구 데이터를 찾지 못했습니다. [empty-result] ${reason}`,
        diagnostics: {
          pagesFetched: pfc3.pagesFetched,
          rawFacilityCount: pfc3.items.length,
          matchedSidoCount: matchedSido.length,
        },
      });
    }
    return NextResponse.json({ sigungu, source: 'public-api', diagnostics: { pagesFetched: pfc3.pagesFetched, rawFacilityCount: pfc3.items.length } });
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
