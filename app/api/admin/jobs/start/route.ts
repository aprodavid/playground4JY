import { z } from 'zod';
import { createJob, getLatestJob } from '@/lib/firestore-repo';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/admin-json';

const schema = z.object({
  type: z.enum(['baseline', 'ride']),
});

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return jsonError('invalid payload', { status: 400, detailMessage: JSON.stringify(parsed.error.flatten()) });
    }

    const { type } = parsed.data;
    const running = await getLatestJob(type);
    if (running && (running.status === 'queued' || running.status === 'running')) {
      return jsonOk({ message: 'already running', job: running }, 409);
    }

    const job = await createJob(type);
    return jsonOk({ message: `${type} job queued`, job }, 201);
  } catch (error) {
    return jsonError('start job failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
