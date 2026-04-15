import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { processOneJob } from './job-processor.js';
import { PUBLIC_DATA_SERVICE_KEY } from './shared.js';

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
