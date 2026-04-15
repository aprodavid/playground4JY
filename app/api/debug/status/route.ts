import { NextResponse } from 'next/server';
import { BASELINE_META_KEY } from '@/src/config/firestore';
import { getCacheMeta, getCollectionCounts, getLatestJob } from '@/lib/firestore-repo';

export const runtime = 'nodejs';

export async function GET() {
  const [baselineMeta, baselineJob, rideJob, counts] = await Promise.all([
    getCacheMeta(BASELINE_META_KEY),
    getLatestJob('baseline'),
    getLatestJob('ride'),
    getCollectionCounts(),
  ]);

  return NextResponse.json({
    baseline: {
      status: baselineMeta?.baselineStatus ?? 'idle',
      ready: baselineMeta?.baselineReady ?? false,
      lastSuccessfulBaselineAt: baselineMeta?.lastSuccessfulBaselineAt ?? null,
      currentStage: baselineMeta?.baselineCurrentStage ?? null,
    },
    ride: {
      status: baselineMeta?.rideStatus ?? 'idle',
      progress: baselineMeta?.rideProgress ?? null,
    },
    cacheCounts: {
      facilities: counts.facilities,
      rideCache: counts.rideCache,
      sigunguIndex: counts.sigunguIndex,
      cacheMeta: counts.cacheMeta,
    },
    sigunguIndexCount: counts.sigunguIndex,
    latestJobs: { baseline: baselineJob, ride: rideJob },
    baselineMeta,
    jobs: { baseline: baselineJob, ride: rideJob },
    counts,
  });
}
