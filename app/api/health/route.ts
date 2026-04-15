import { NextResponse } from 'next/server';
import { getFirestoreAdmin } from '@/lib/firestore';
import { fetchPfc3WithMeta } from '@/lib/public-data';

export const runtime = 'nodejs';

export async function GET() {
  const env = {
    PUBLIC_DATA_BASE_URL: Boolean(process.env.PUBLIC_DATA_BASE_URL),
    PUBLIC_DATA_SERVICE_KEY: Boolean(process.env.PUBLIC_DATA_SERVICE_KEY),
    FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  };

  const firebase = { ok: false, error: null as string | null };
  const publicApi = { ok: false, error: null as string | null, sample: null as unknown };

  try {
    await getFirestoreAdmin().collection('cacheMeta').limit(1).get();
    firebase.ok = true;
  } catch (error) {
    firebase.error = error instanceof Error ? error.message : 'unknown error';
  }

  try {
    const sample = await fetchPfc3WithMeta({ inslPlcSeCd: 'A003', pageIndex: 1, pageNo: 1, numOfRows: 1, recordCountPerPage: 1 });
    publicApi.ok = true;
    publicApi.sample = { status: sample.meta.status, itemCount: sample.meta.itemCount };
  } catch (error) {
    publicApi.error = error instanceof Error ? error.message : 'unknown error';
  }

  const ok = Object.values(env).every(Boolean) && firebase.ok && publicApi.ok;
  return NextResponse.json({ env, firebase, publicApi }, { status: ok ? 200 : 500 });
}
