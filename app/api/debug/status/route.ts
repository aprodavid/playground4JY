import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getCollectionCounts, getLatestCacheMeta } from '@/lib/firestore-repo';
import { getFirestoreAdmin } from '@/lib/firestore';

export const runtime = 'nodejs';

async function checkPublicApi(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return { ok: true, hostname: url.hostname };
  } catch {
    return { ok: false, hostname: null };
  }
}

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
    publicApi: { ok: false as boolean, baseUrl: process.env.PUBLIC_DATA_BASE_URL ?? null, hostname: null as string | null },
    counts: { facilities: 0, rideCache: 0, cacheMeta: 0 },
    latestCacheBuild: null as Awaited<ReturnType<typeof getLatestCacheMeta>>,
  };

  try {
    const baseUrl = getEnv('PUBLIC_DATA_BASE_URL');
    const publicApiCheck = await checkPublicApi(baseUrl);
    result.publicApi.ok = publicApiCheck.ok;
    result.publicApi.hostname = publicApiCheck.hostname;
  } catch {
    result.publicApi.ok = false;
  }

  try {
    const db = getFirestoreAdmin();
    await db.collection('facilities').limit(1).get();
    result.firebase.ok = true;
    result.counts = await getCollectionCounts();
    result.latestCacheBuild = await getLatestCacheMeta();
  } catch (error) {
    result.firebase.ok = false;
    result.firebase.error = error instanceof Error ? error.message : 'unknown error';
  }

  const statusCode = Object.values(envStatus).every(Boolean) ? 200 : 500;
  return NextResponse.json(result, { status: statusCode });
}
