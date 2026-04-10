import { NextResponse } from 'next/server';
import { BASELINE_META_KEY, getCacheMeta, getCollectionCounts, getLatestCacheMeta, getLatestJob } from '@/lib/firestore-repo';
import { getFirestoreAdmin } from '@/lib/firestore';

export const runtime = 'nodejs';

export async function GET() {
  const envStatus = {
    PUBLIC_DATA_BASE_URL: Boolean(process.env.PUBLIC_DATA_BASE_URL),
    PUBLIC_DATA_SERVICE_KEY: false,
    FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  };

  const result = {
    env: envStatus,
    functionsSecretMode: {
      PUBLIC_DATA_SERVICE_KEY: true,
      message: 'PUBLIC_DATA_SERVICE_KEY is managed by Firebase Functions Secret Manager.',
    },
    firebase: { ok: false as boolean, error: null as string | null },
    counts: { facilities: 0, rideCache: 0, cacheMeta: 0, sigunguIndex: 0, jobs: 0 },
    latestCacheBuild: null as Awaited<ReturnType<typeof getLatestCacheMeta>>,
    baselineMeta: null as Awaited<ReturnType<typeof getCacheMeta>>,
    jobs: {
      baseline: null as Awaited<ReturnType<typeof getLatestJob>>,
      ride: null as Awaited<ReturnType<typeof getLatestJob>>,
    },
  };

  try {
    const db = getFirestoreAdmin();
    await db.collection('facilities').limit(1).get();
    result.firebase.ok = true;

    const [counts, latest, baselineMeta, baselineJob, rideJob] = await Promise.all([
      getCollectionCounts(),
      getLatestCacheMeta(),
      getCacheMeta(BASELINE_META_KEY),
      getLatestJob('baseline'),
      getLatestJob('ride'),
    ]);

    result.counts = counts;
    result.latestCacheBuild = latest;
    result.baselineMeta = baselineMeta;
    result.jobs.baseline = baselineJob;
    result.jobs.ride = rideJob;
  } catch (error) {
    result.firebase.ok = false;
    result.firebase.error = error instanceof Error ? error.message : 'unknown error';
  }

  const vercelEnvOk = envStatus.PUBLIC_DATA_BASE_URL && envStatus.FIREBASE_PROJECT_ID && envStatus.FIREBASE_CLIENT_EMAIL && envStatus.FIREBASE_PRIVATE_KEY;
  const statusCode = vercelEnvOk && result.firebase.ok ? 200 : 500;
  return NextResponse.json(result, { status: statusCode });
}
