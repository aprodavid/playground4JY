import { NextRequest, NextResponse } from 'next/server';
import { getBaselineMeta, getCollectionCounts, getRideMeta } from '@/lib/firestore-repo';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sido = req.nextUrl.searchParams.get('sido') ?? '서울특별시';
  const [baselineMeta, rideMeta, counts] = await Promise.all([
    getBaselineMeta(sido),
    getRideMeta(),
    getCollectionCounts(),
  ]);

  return NextResponse.json({
    selectedSido: sido,
    baseline: baselineMeta ? {
      status: baselineMeta.status,
      ready: baselineMeta.baselineReady,
      currentStage: baselineMeta.currentStage,
      currentInstallPlace: baselineMeta.currentInstallPlace,
      currentPage: baselineMeta.currentPage,
      totalPages: baselineMeta.totalPages,
      pagesFetched: baselineMeta.pagesFetched,
      rawFacilityCount: baselineMeta.rawFacilityCount,
      filteredFacilityCount: baselineMeta.filteredFacilityCount,
      lastPageItemCount: baselineMeta.lastPageItemCount,
      parsePathUsed: baselineMeta.parsePathUsed,
      lastError: baselineMeta.lastError,
      lastSuccessfulBaselineAt: baselineMeta.lastSuccessfulBaselineAt ?? null,
    } : null,
    ride: rideMeta ? {
      status: rideMeta.status,
      progress: rideMeta.progress,
      lastError: rideMeta.lastError,
      lastSuccessfulAt: rideMeta.lastSuccessfulAt ?? null,
    } : null,
    cacheCounts: counts,
  });
}
