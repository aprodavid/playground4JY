import { runSelectedSidoBaseline } from './baseline.js';
import { runRideUpdater } from './ride.js';
import { PUBLIC_DATA_SERVICE_KEY, db } from './shared.js';

export async function processOneJob() {
  const secret = PUBLIC_DATA_SERVICE_KEY.value();

  const baselineQueued = await db.collection('cacheMeta')
    .where('regionKey', '>=', 'baseline:')
    .where('regionKey', '<', 'baseline;')
    .where('status', 'in', ['queued', 'running'])
    .limit(1)
    .get();

  if (!baselineQueued.empty) {
    const doc = baselineQueued.docs[0];
    const sido = String(doc.get('sido') ?? '').trim();
    if (!sido) throw new Error('baseline meta missing sido');
    await runSelectedSidoBaseline(sido, secret);
    return { processed: true, type: 'baseline', sido };
  }

  const rideDoc = await db.collection('cacheMeta').doc('ride:global').get();
  const rideStatus = String(rideDoc.get('status') ?? 'idle');
  if (rideStatus === 'queued' || rideStatus === 'running') {
    await runRideUpdater(secret);
    return { processed: true, type: 'ride' };
  }

  return { processed: false };
}
