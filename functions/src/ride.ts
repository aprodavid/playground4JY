import { callApi, db, nowIso, RIDE_STEP_TARGETS, type JobDoc } from './shared.js';
import { upsertBaselineMeta } from './lib/firestore-repo.js';

async function loadRideTargets() {
  const snap = await db.collection('facilities').get();
  const coordinateWinner = new Map<string, number>();

  snap.docs.forEach((d) => {
    const x = d.data();
    const pfctSn = Number(x.pfctSn);
    if (!Number.isFinite(pfctSn)) return;
    const key = x.lat && x.lng ? `${Number(x.lat).toFixed(6)}:${Number(x.lng).toFixed(6)}` : `pfct:${pfctSn}`;
    const existing = coordinateWinner.get(key);
    if (!existing || pfctSn < existing) coordinateWinner.set(key, pfctSn);
  });

  return [...coordinateWinner.values()];
}

export async function processRideStep(job: JobDoc, serviceKey: string) {
  const now = nowIso();
  const targets = job.cursor?.targets ?? await loadRideTargets();
  let offset = job.cursor?.offset ?? 0;
  let scanned = 0;
  let success = 0;
  let error = 0;

  const selected: number[] = [];
  while (offset < targets.length && selected.length < RIDE_STEP_TARGETS) {
    const pfctSn = targets[offset];
    offset += 1;
    scanned += 1;
    const existing = await db.collection('rideCache').doc(String(pfctSn)).get();
    if (existing.exists) {
      continue;
    }
    selected.push(pfctSn);
  }

  const writer = db.bulkWriter();
  for (const pfctSn of selected) {
    try {
      const fetched = await callApi('/ride4/getRideInfo4', { pfctSn }, serviceKey);
      const types = [...new Set(fetched.list.map((x) => String(x.playkndCd)).filter(Boolean))];
      writer.set(db.collection('rideCache').doc(String(pfctSn)), {
        pfctSn,
        rawCount: fetched.list.length,
        filteredCount: fetched.list.length,
        typeCount: types.length,
        types,
        status: fetched.list.length ? 'ok' : 'empty',
        updatedAt: now,
      }, { merge: true });
      success += 1;
    } catch (e) {
      writer.set(db.collection('rideCache').doc(String(pfctSn)), {
        pfctSn,
        rawCount: 0,
        filteredCount: 0,
        typeCount: 0,
        types: [],
        status: 'error',
        updatedAt: now,
        lastError: e instanceof Error ? e.message : 'unknown error',
      }, { merge: true });
      error += 1;
    }
  }
  await writer.close();

  const done = offset >= targets.length;
  const prevScanned = job.cursor?.scannedTargets ?? 0;

  await db.collection('jobs').doc(job.jobId).set({
    status: done ? 'success' : 'running',
    currentStage: done ? 'completed' : 'ride-batch',
    currentPage: offset,
    totalPages: targets.length,
    pagesFetched: (job.pagesFetched ?? 0) + 1,
    successCount: (job.successCount ?? 0) + success,
    errorCount: (job.errorCount ?? 0) + error,
    cursor: {
      ...job.cursor,
      offset,
      targets,
      scannedTargets: prevScanned + scanned,
    },
    updatedAt: now,
  }, { merge: true });

  await upsertBaselineMeta({
    rideStatus: done ? 'success' : 'running',
    rideUpdatedAt: now,
    rideStartedAt: job.startedAt ?? now,
    rideProgress: {
      totalTargets: targets.length,
      processedTargets: offset,
      updatedTargets: (job.successCount ?? 0) + success,
      errorTargets: (job.errorCount ?? 0) + error,
      skippedExistingTargets: Number((job.cursor?.scannedTargets ?? 0)) + scanned - ((job.successCount ?? 0) + success + (job.errorCount ?? 0) + error),
    },
  });
}
