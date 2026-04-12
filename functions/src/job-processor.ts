import { processBaselineStep } from './baseline.js';
import { processRideStep } from './ride.js';
import { BASELINE_STEP_BUDGET, PUBLIC_DATA_SERVICE_KEY, db, nowIso, type JobDoc } from './shared.js';
import { upsertBaselineMeta } from './firestore-repo.js';

export async function processOneJob() {
  const snap = await db.collection('jobs')
    .where('status', 'in', ['queued', 'running'])
    .orderBy('startedAt', 'asc')
    .limit(1)
    .get();

  if (snap.empty) return { processed: false };

  const doc = snap.docs[0];
  const job = { ...(doc.data() as JobDoc), jobId: doc.id };

  if (job.stopRequested) {
    const now = nowIso();
    await doc.ref.set({ status: 'stopped', updatedAt: now, currentStage: 'stopped' }, { merge: true });
    if (job.type === 'baseline') {
      await upsertBaselineMeta({ baselineStatus: 'stopped', status: 'stopped', baselineReady: false, updatedAt: now, baselineUpdatedAt: now, done: true });
    } else {
      await upsertBaselineMeta({ rideStatus: 'stopped', rideUpdatedAt: now });
    }
    return { processed: true, stopped: true, jobId: doc.id };
  }

  let secret = '';
  try {
    secret = PUBLIC_DATA_SERVICE_KEY.value();
  } catch (error) {
    console.error('Missing Environment Variable: PUBLIC_DATA_SERVICE_KEY could not be resolved.', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    throw new Error('Missing Environment Variable: PUBLIC_DATA_SERVICE_KEY');
  }
  const now = nowIso();

  if (job.status === 'queued') {
    await doc.ref.set({ status: 'running', currentStage: 'starting', updatedAt: now }, { merge: true });
    if (job.type === 'baseline') {
      await upsertBaselineMeta({
        status: 'running',
        baselineStatus: 'running',
        baselineReady: false,
        baselineSource: 'api-crawl',
        baselineStartedAt: job.startedAt ?? now,
        baselineUpdatedAt: now,
        baselineCurrentStage: 'starting',
        done: false,
        lastError: null,
        baselineLastError: null,
      });
    } else {
      await upsertBaselineMeta({
        rideStatus: 'running',
        rideStartedAt: job.startedAt ?? now,
        rideUpdatedAt: now,
        rideLastError: null,
      });
    }
  }

  try {
    if (job.type === 'baseline') {
      for (let i = 0; i < BASELINE_STEP_BUDGET; i += 1) {
        const fresh = await db.collection('jobs').doc(job.jobId).get();
        const freshJob = fresh.data() as JobDoc | undefined;
        if (!freshJob || freshJob.status === 'success' || freshJob.status === 'stopped' || freshJob.status === 'error') break;
        await processBaselineStep({ ...freshJob, jobId: job.jobId }, secret);
      }
    }

    if (job.type === 'ride') await processRideStep(job, secret);
    return { processed: true, jobId: doc.id, type: job.type };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'unknown error';
    await doc.ref.set({
      status: 'error',
      lastError: errMsg,
      updatedAt: nowIso(),
      errorCount: (job.errorCount ?? 0) + 1,
    }, { merge: true });

    if (job.type === 'baseline') {
      await upsertBaselineMeta({
        status: 'error',
        baselineStatus: 'error',
        baselineReady: false,
        baselineUpdatedAt: nowIso(),
        baselineLastError: errMsg,
        lastError: errMsg,
        done: true,
        lastBuildStatus: 'error',
      });
    } else {
      await upsertBaselineMeta({ rideStatus: 'error', rideUpdatedAt: nowIso(), rideLastError: errMsg });
    }
    throw error;
  }
}
