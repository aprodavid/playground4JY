import { NextRequest } from 'next/server';
import { getJobById, getLatestJob } from '@/lib/firestore-repo';
import { jsonError, jsonOk } from '@/lib/admin-json';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get('jobId');
    const type = req.nextUrl.searchParams.get('type') as 'baseline' | 'ride' | null;

    const job = jobId ? await getJobById(jobId) : await getLatestJob(type ?? undefined);
    return jsonOk({ job });
  } catch (error) {
    return jsonError('job status failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
