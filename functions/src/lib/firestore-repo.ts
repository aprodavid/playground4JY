import { db } from '../shared.js';

export const RIDE_META_KEY = 'ride:global';
export const baselineMetaKey = (sido: string) => `baseline:${sido}`;

export async function upsertBaselineMeta(sido: string, patch: Record<string, unknown>) {
  await db.collection('cacheMeta').doc(baselineMetaKey(sido)).set({
    regionKey: baselineMetaKey(sido),
    sido,
    ...patch,
  }, { merge: true });
}
