import { z } from 'zod';
import { BASELINE_META_KEY, createJob, getCacheMeta, getLatestJob, setCacheMeta } from '@/lib/firestore-repo';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/admin-json';

const schema = z.object({
  type: z.enum(['baseline', 'ride']),
  mode: z.enum(['normal', 'force-rebuild']).optional(),
});

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return jsonError('invalid payload', { status: 400, detailMessage: JSON.stringify(parsed.error.flatten()) });
    }

    const { type } = parsed.data;
    const mode = parsed.data.mode ?? 'normal';
    const running = await getLatestJob(type);
    if (running && (running.status === 'queued' || running.status === 'running')) {
      return jsonOk({ message: 'already running', job: running }, 409);
    }

    const baselineMeta = await getCacheMeta(BASELINE_META_KEY);
    if (type === 'baseline' && mode !== 'force-rebuild' && baselineMeta?.baselineReady && baselineMeta?.baselineStatus === 'success') {
      return jsonOk({
        message: 'baseline already ready; reuse enabled',
        skipped: true,
        baselineMeta,
      }, 200);
    }

    const job = await createJob(type);
    const now = new Date().toISOString();
    if (type === 'baseline') {
      await setCacheMeta(BASELINE_META_KEY, {
        regionKey: BASELINE_META_KEY,
        status: 'running',
        baselineStatus: 'running',
        baselineReady: false,
        baselineCurrentStage: 'queued',
        baselineStartedAt: job.startedAt ?? now,
        baselineUpdatedAt: now,
        baselineVersion: mode === 'force-rebuild' ? now : (baselineMeta?.baselineVersion ?? now),
        baselineBuildMode: mode,
        lastSuccessfulBaselineAt: baselineMeta?.lastSuccessfulBaselineAt,
        done: false,
      });
    } else {
      await setCacheMeta(BASELINE_META_KEY, {
        regionKey: BASELINE_META_KEY,
        rideStatus: 'running',
        rideStartedAt: job.startedAt ?? now,
        rideUpdatedAt: now,
      });
    }

    return jsonOk({
      message: `${type} job queued. Firebase Functions will process it in background.`,
      job,
    }, 201);
  } catch (error) {
    return jsonError('start job failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
