import { initializeApp } from 'firebase-admin/app';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { processOneJob } from './job-processor.js';
import { PUBLIC_DATA_SERVICE_KEY } from './shared.js';

initializeApp();

export const workerTick = onSchedule({
  schedule: 'every 2 minutes',
  region: 'asia-northeast3',
  secrets: [PUBLIC_DATA_SERVICE_KEY],
}, async () => {
  await processOneJob();
});

export const workerKick = onRequest({
  region: 'asia-northeast3',
  secrets: [PUBLIC_DATA_SERVICE_KEY],
}, async (_req: unknown, res: { status: (code: number) => { json: (payload: unknown) => void } }) => {
  const result = await processOneJob();
  res.status(200).json(result);
});

export const onJobCreatedKick = onDocumentCreated({
  document: 'jobs/{jobId}',
  region: 'asia-northeast3',
  secrets: [PUBLIC_DATA_SERVICE_KEY],
}, async () => {
  await processOneJob();
});

export { BASELINE_META_KEY, upsertBaselineMeta } from './lib/firestore-repo.js';
export type { CacheMetaDoc, JobDoc } from './types/domain.js';
