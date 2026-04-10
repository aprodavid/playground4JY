import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { BASELINE_META_KEY, getCollectionCounts, getLatestCacheMeta, getCacheMeta } from '@/lib/firestore-repo';
import { getFirestoreAdmin } from '@/lib/firestore';
import { fetchPfc3WithMeta, PublicDataError } from '@/lib/public-data';

export const runtime = 'nodejs';

export async function GET() {
  const envStatus = {
    PUBLIC_DATA_BASE_URL: Boolean(process.env.PUBLIC_DATA_BASE_URL),
    PUBLIC_DATA_SERVICE_KEY: Boolean(process.env.PUBLIC_DATA_SERVICE_KEY),
    FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  };

  const result = {
    env: envStatus,
    firebase: { ok: false as boolean, error: null as string | null },
    publicApi: {
      ok: false as boolean,
      baseUrl: process.env.PUBLIC_DATA_BASE_URL ?? null,
      endpoint: '/pfc3/getPfctInfo3',
      finalUrl: null as string | null,
      keyFallback: {
        rawAttempted: false,
        rawSuccess: false,
        encodedAttempted: false,
        encodedSuccess: false,
      },
      status: null as number | null,
      parseOk: false,
      itemCount: 0,
      pageInfo: {
        totalPageCnt: null as number | null,
        totalCount: null as number | null,
        pageIndex: null as number | null,
        recordCountPerPage: null as number | null,
        pageNo: null as number | null,
        numOfRows: null as number | null,
      },
      attempts: [] as unknown[],
      errorType: null as string | null,
      errorMessage: null as string | null,
    },
    counts: { facilities: 0, rideCache: 0, cacheMeta: 0, sigunguIndex: 0 },
    latestCacheBuild: null as Awaited<ReturnType<typeof getLatestCacheMeta>>,
    baselineMeta: null as Awaited<ReturnType<typeof getCacheMeta>>,

    baseline: {
      status: null as string | null,
      source: null as string | null,
    },
  };

  try {
    getEnv('PUBLIC_DATA_BASE_URL');
    getEnv('PUBLIC_DATA_SERVICE_KEY');
    const pfc3 = await fetchPfc3WithMeta({ pageIndex: 1, recordCountPerPage: 1 });
    const attempts = pfc3.meta.attempts;
    result.publicApi.ok = true;
    result.publicApi.baseUrl = pfc3.meta.baseUrl;
    result.publicApi.finalUrl = pfc3.meta.finalUrl;
    result.publicApi.status = pfc3.meta.status;
    result.publicApi.parseOk = pfc3.meta.parseOk;
    result.publicApi.itemCount = pfc3.meta.itemCount;
    result.publicApi.pageInfo = pfc3.meta.pageInfo;
    result.publicApi.attempts = attempts;
    result.publicApi.keyFallback = {
      rawAttempted: attempts.some((a) => (a as { keyMode?: string }).keyMode === 'raw'),
      rawSuccess: attempts.some((a) => (a as { keyMode?: string; ok?: boolean }).keyMode === 'raw' && (a as { ok?: boolean }).ok),
      encodedAttempted: attempts.some((a) => (a as { keyMode?: string }).keyMode === 'encoded'),
      encodedSuccess: attempts.some((a) => (a as { keyMode?: string; ok?: boolean }).keyMode === 'encoded' && (a as { ok?: boolean }).ok),
    };
  } catch (error) {
    result.publicApi.ok = false;
    if (error instanceof PublicDataError) {
      result.publicApi.errorType = error.detail.type;
      result.publicApi.errorMessage = error.message;
      result.publicApi.status = error.detail.status ?? null;
      result.publicApi.finalUrl = error.detail.url ?? null;
      result.publicApi.attempts = error.detail.attempts ?? [];
      const attempts = error.detail.attempts ?? [];
      result.publicApi.keyFallback = {
        rawAttempted: attempts.some((a) => a.keyMode === 'raw'),
        rawSuccess: attempts.some((a) => a.keyMode === 'raw' && a.ok),
        encodedAttempted: attempts.some((a) => a.keyMode === 'encoded'),
        encodedSuccess: attempts.some((a) => a.keyMode === 'encoded' && a.ok),
      };
    } else {
      result.publicApi.errorType = 'unknown';
      result.publicApi.errorMessage = error instanceof Error ? error.message : 'unknown error';
    }
  }

  try {
    const db = getFirestoreAdmin();
    await db.collection('facilities').limit(1).get();
    result.firebase.ok = true;
    const [counts, latest, baseline] = await Promise.all([
      getCollectionCounts(),
      getLatestCacheMeta(),
      getCacheMeta(BASELINE_META_KEY),
    ]);
    result.counts = counts;
    result.latestCacheBuild = latest;
    result.baselineMeta = baseline;
    result.baseline.status = baseline?.baselineStatus ?? null;
    result.baseline.source = baseline?.baselineSource ?? 'none';
  } catch (error) {
    result.firebase.ok = false;
    result.firebase.error = error instanceof Error ? error.message : 'unknown error';
  }

  const statusCode = Object.values(envStatus).every(Boolean) && result.publicApi.ok ? 200 : 500;
  return NextResponse.json(result, { status: statusCode });
}
