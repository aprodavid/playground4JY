import { getFirestoreAdmin } from './firestore';
import { stripUndefinedDeep } from './normalization';
import type { CacheMetaDoc, FacilityDoc, JobDoc, JobType, RideCacheDoc } from '@/types/domain';

function sanitizeForFirestoreWrite<T>(doc: T): T {
  return stripUndefinedDeep(doc);
}

export const BASELINE_META_KEY = 'baseline:global';
const PFC3_UPLOAD_COLLECTION = 'baselineUploadPfc3';
const EXFC5_UPLOAD_COLLECTION = 'baselineUploadExfc5';

export async function upsertFacilities(facilities: FacilityDoc[]) {
  if (facilities.length === 0) return;
  const db = getFirestoreAdmin();
  const refs = facilities.map((f) => db.collection('facilities').doc(String(f.pfctSn)));
  const existingDocs = new Map<string, FirebaseFirestore.DocumentData>();

  for (let i = 0; i < refs.length; i += 250) {
    const chunkRefs = refs.slice(i, i + 250);
    const snapshots = await db.getAll(...chunkRefs);
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) existingDocs.set(snapshot.id, snapshot.data() ?? {});
    });
  }

  const writer = db.bulkWriter();
  for (const facility of facilities) {
    const id = String(facility.pfctSn);
    const existing = existingDocs.get(id);
    if (existing && existing.contentHash && existing.contentHash === facility.contentHash) {
      continue;
    }
    writer.set(db.collection('facilities').doc(id), sanitizeForFirestoreWrite(facility), { merge: true });
  }
  await writer.close();
}

export async function replaceFacilities(facilities: FacilityDoc[]) {
  await clearCollection('facilities');
  await upsertFacilities(facilities);
}

export async function getFacilitiesByRegion(sido: string, sigungu?: string) {
  const db = getFirestoreAdmin();
  let query = db.collection('facilities').where('sido', '==', sido);
  if (sigungu) query = query.where('sigungu', '==', sigungu.replace(/\s+/g, ''));
  const snap = await query.get();
  return snap.docs.map((d) => d.data() as FacilityDoc);
}

export async function getAllFacilities() {
  const db = getFirestoreAdmin();
  const snap = await db.collection('facilities').get();
  return snap.docs.map((d) => d.data() as FacilityDoc);
}

export async function getRideCaches(pfctSns: number[]) {
  if (pfctSns.length === 0) return [];
  const db = getFirestoreAdmin();
  const chunks: number[][] = [];
  for (let i = 0; i < pfctSns.length; i += 30) chunks.push(pfctSns.slice(i, i + 30));

  const results: RideCacheDoc[] = [];
  for (const chunk of chunks) {
    const snap = await db.collection('rideCache').where('pfctSn', 'in', chunk).get();
    snap.docs.forEach((d) => results.push(d.data() as RideCacheDoc));
  }
  return results;
}

export async function upsertRideCache(doc: RideCacheDoc) {
  const db = getFirestoreAdmin();
  await db.collection('rideCache').doc(String(doc.pfctSn)).set(sanitizeForFirestoreWrite(doc), { merge: true });
}

export async function setCacheMeta(regionKey: string, meta: Partial<CacheMetaDoc>) {
  const db = getFirestoreAdmin();
  await db.collection('cacheMeta').doc(regionKey).set(sanitizeForFirestoreWrite(meta), { merge: true });
}

export async function getCacheMeta(regionKey: string) {
  const db = getFirestoreAdmin();
  const snap = await db.collection('cacheMeta').doc(regionKey).get();
  return snap.exists ? (snap.data() as CacheMetaDoc) : null;
}

export async function setSigunguIndex(sido: string, sigungu: string[]) {
  const db = getFirestoreAdmin();
  await db.collection('sigunguIndex').doc(sido).set({ sido, sigungu, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function rebuildSigunguIndexFromFacilities() {
  await clearCollection('sigunguIndex');
  const facilities = await getAllFacilities();
  const sigunguMap = new Map<string, Set<string>>();
  facilities.forEach((facility) => {
    if (!facility.sido) return;
    if (!sigunguMap.has(facility.sido)) sigunguMap.set(facility.sido, new Set());
    if (facility.sigungu) sigunguMap.get(facility.sido)!.add(facility.sigungu);
  });

  for (const [sido, sigunguSet] of sigunguMap.entries()) {
    await setSigunguIndex(sido, [...sigunguSet].sort());
  }
}

export async function getSigunguBySido(sido: string) {
  const db = getFirestoreAdmin();
  const doc = await db.collection('sigunguIndex').doc(sido).get();
  if (!doc.exists) return [];
  const list = (doc.get('sigungu') as string[] | undefined) ?? [];
  return [...new Set(list)].sort();
}

export async function getCollectionCounts() {
  const db = getFirestoreAdmin();
  const [facilities, rideCache, cacheMeta, sigunguIndex, jobs] = await Promise.all([
    db.collection('facilities').count().get(),
    db.collection('rideCache').count().get(),
    db.collection('cacheMeta').count().get(),
    db.collection('sigunguIndex').count().get(),
    db.collection('jobs').count().get(),
  ]);

  return {
    facilities: facilities.data().count,
    rideCache: rideCache.data().count,
    cacheMeta: cacheMeta.data().count,
    sigunguIndex: sigunguIndex.data().count,
    jobs: jobs.data().count,
  };
}

export async function getLatestCacheMeta() {
  const db = getFirestoreAdmin();
  const snap = await db.collection('cacheMeta').orderBy('lastBuiltAt', 'desc').limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data() as CacheMetaDoc;
}

export async function createJob(type: JobType) {
  const db = getFirestoreAdmin();
  const ref = db.collection('jobs').doc();
  const now = new Date().toISOString();
  const job: JobDoc = {
    jobId: ref.id,
    type,
    status: 'queued',
    startedAt: now,
    updatedAt: now,
    currentStage: type === 'baseline' ? 'queued' : 'queued',
    currentPage: 1,
    pagesFetched: 0,
    rawFacilityCount: 0,
    filteredFacilityCount: 0,
    successCount: 0,
    errorCount: 0,
    stopRequested: false,
    lastError: null,
    resultSummary: null,
  };
  await ref.set(sanitizeForFirestoreWrite(job), { merge: false });
  return job;
}

export async function getLatestJob(type?: JobType) {
  const db = getFirestoreAdmin();
  let query = db.collection('jobs').orderBy('startedAt', 'desc').limit(1);
  if (type) query = db.collection('jobs').where('type', '==', type).orderBy('startedAt', 'desc').limit(1);
  const snap = await query.get();
  if (snap.empty) return null;
  return snap.docs[0].data() as JobDoc;
}

export async function getJobById(jobId: string) {
  const db = getFirestoreAdmin();
  const snap = await db.collection('jobs').doc(jobId).get();
  return snap.exists ? (snap.data() as JobDoc) : null;
}

export async function requestStopJob(jobId: string) {
  const db = getFirestoreAdmin();
  await db.collection('jobs').doc(jobId).set({
    stopRequested: true,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function getFacilityByPfctSn(pfctSn: number) {
  const db = getFirestoreAdmin();
  const [facility, ride] = await Promise.all([
    db.collection('facilities').doc(String(pfctSn)).get(),
    db.collection('rideCache').doc(String(pfctSn)).get(),
  ]);
  return {
    facility: facility.exists ? (facility.data() as FacilityDoc) : null,
    ride: ride.exists ? (ride.data() as RideCacheDoc) : null,
  };
}

export async function clearCollection(name: string) {
  const db = getFirestoreAdmin();
  while (true) {
    const snap = await db.collection(name).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

export async function saveUploadRows(kind: 'pfc3' | 'exfc5', rows: Record<string, unknown>[]) {
  const db = getFirestoreAdmin();
  const collection = kind === 'pfc3' ? PFC3_UPLOAD_COLLECTION : EXFC5_UPLOAD_COLLECTION;
  await clearCollection(collection);

  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    rows.slice(i, i + 400).forEach((row, idx) => {
      batch.set(db.collection(collection).doc(String(i + idx)), sanitizeForFirestoreWrite({ row, idx: i + idx }));
    });
    await batch.commit();
  }
}

export async function getUploadRows(kind: 'pfc3' | 'exfc5') {
  const db = getFirestoreAdmin();
  const collection = kind === 'pfc3' ? PFC3_UPLOAD_COLLECTION : EXFC5_UPLOAD_COLLECTION;
  const snap = await db.collection(collection).orderBy('idx', 'asc').get();
  return snap.docs.map((d) => (d.data().row ?? {}) as Record<string, unknown>);
}

export async function getUploadCounts() {
  const db = getFirestoreAdmin();
  const [pfc3, exfc5] = await Promise.all([
    db.collection(PFC3_UPLOAD_COLLECTION).count().get(),
    db.collection(EXFC5_UPLOAD_COLLECTION).count().get(),
  ]);
  return {
    pfc3: pfc3.data().count,
    exfc5: exfc5.data().count,
  };
}
