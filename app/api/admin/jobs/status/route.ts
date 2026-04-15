import { NextRequest } from 'next/server';
import { getBaselineMeta, getRideMeta } from '@/lib/firestore-repo';
import { jsonError, jsonOk } from '@/lib/admin-json';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get('type') as 'baseline' | 'ride' | null;
    const sido = req.nextUrl.searchParams.get('sido');

    if (type === 'baseline') {
      if (!sido) return jsonError('sido is required', { status: 400 });
      return jsonOk({ baseline: await getBaselineMeta(sido) });
    }

    if (type === 'ride') return jsonOk({ ride: await getRideMeta() });

    return jsonOk({ baseline: sido ? await getBaselineMeta(sido) : null, ride: await getRideMeta() });
  } catch (error) {
    return jsonError('job status failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
