import { callApi, db, nowIso, RIDE_URL, RIDE_WHITELIST } from './shared.js';

export async function runRideUpdater(serviceKey: string) {
  const metaRef = db.collection('cacheMeta').doc('ride:global');
  const metaSnap = await metaRef.get();
  const meta = (metaSnap.data() ?? {}) as { stopRequested?: boolean; progress?: Record<string, number> };

  if (meta.stopRequested) {
    await metaRef.set({ status: 'stopped', updatedAt: nowIso() }, { merge: true });
    return { stopped: true };
  }

  const facilities = await db.collection('facilities').get();
  const coordinateWinner = new Map<string, string>();
  facilities.docs.forEach((d) => {
    const x = d.data();
    const pfctSn = String(x.pfctSn ?? '').trim();
    if (!pfctSn) return;
    const key = x.lat && x.lng ? `${Number(x.lat).toFixed(6)}:${Number(x.lng).toFixed(6)}` : `pfct:${pfctSn}`;
    const existing = coordinateWinner.get(key);
    if (!existing || pfctSn.localeCompare(existing) < 0) coordinateWinner.set(key, pfctSn);
  });
  const targets = [...coordinateWinner.values()];

  let processed = 0;
  let updated = 0;
  let errored = 0;
  let skipped = 0;
  const writer = db.bulkWriter();

  for (const pfctSn of targets) {
    processed += 1;
    const existing = await db.collection('rideCache').doc(pfctSn).get();
    if (existing.exists) { skipped += 1; continue; }

    try {
      const fetched = await callApi(RIDE_URL, { pfctSn }, serviceKey);
      const types = [...new Set(fetched.list.map((x) => String(x.playkndCd ?? '')).filter((code) => RIDE_WHITELIST.has(code)))];
      writer.set(db.collection('rideCache').doc(pfctSn), { pfctSn, rawCount: fetched.list.length, filteredCount: fetched.list.length, typeCount: types.length, types, status: fetched.list.length ? 'ok' : 'empty', updatedAt: nowIso() }, { merge: true });
      updated += 1;
    } catch (error) {
      writer.set(db.collection('rideCache').doc(pfctSn), { pfctSn, rawCount: 0, filteredCount: 0, typeCount: 0, types: [], status: 'error', updatedAt: nowIso(), lastError: error instanceof Error ? error.message : 'unknown error' }, { merge: true });
      errored += 1;
    }
  }

  await writer.close();
  await metaRef.set({
    regionKey: 'ride:global',
    status: 'success',
    stopRequested: false,
    updatedAt: nowIso(),
    lastSuccessfulAt: nowIso(),
    lastError: null,
    progress: {
      totalTargets: targets.length,
      processedTargets: processed,
      updatedTargets: updated,
      errorTargets: errored,
      skippedExistingTargets: skipped,
    },
  }, { merge: true });

  return { success: true, totalTargets: targets.length };
}
