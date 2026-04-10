import { z } from 'zod';
import { getJobById, requestStopJob } from '@/lib/firestore-repo';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/admin-json';

const schema = z.object({ jobId: z.string().min(1) });

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return jsonError('invalid payload', { status: 400, detailMessage: JSON.stringify(parsed.error.flatten()) });
    }

    const { jobId } = parsed.data;
    const job = await getJobById(jobId);
    if (!job) return jsonError('job not found', { status: 404 });

    await requestStopJob(jobId);
    return jsonOk({ message: 'stop requested', jobId });
  } catch (error) {
    return jsonError('stop job failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
