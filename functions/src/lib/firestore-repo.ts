import { db } from '../shared.js';

export const BASELINE_META_KEY = 'baseline:global';

export async function upsertBaselineMeta(patch: Record<string, unknown>) {
  await db.collection('cacheMeta').doc(BASELINE_META_KEY).set({
    regionKey: BASELINE_META_KEY,
    ...patch,
  }, { merge: true });
}
