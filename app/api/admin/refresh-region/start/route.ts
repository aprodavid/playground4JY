import { z } from 'zod';
import { isMissingEnvError } from '@/lib/env';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/admin-json';
import { initRefreshRegionJob, mapJobError } from '@/lib/refresh-region-job';

const schema = z.object({ sido: z.string().min(1), sigungu: z.string().optional() });

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return jsonOk({ message: 'invalid payload', errorType: 'validation', errors: parsed.error.flatten() }, 400);
    }

    const job = await initRefreshRegionJob(parsed.data.sido, parsed.data.sigungu);
    return jsonOk({
      message: 'refresh-region job started',
      regionKey: job.regionKey,
      jobId: job.jobId,
      status: job.status,
      currentStage: job.currentStage,
      selectedRegion: job.selectedRegion,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      done: job.done,
    });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return jsonError(error.message, { status: 500, errorType: 'missing-env' });
    }
    const mapped = mapJobError(error);
    return jsonError(mapped.message, { status: 500, errorType: mapped.errorType, detailMessage: mapped.detailMessage, endpoint: mapped.endpoint });
  }
}
