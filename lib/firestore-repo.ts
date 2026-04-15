import { COLLECTIONS, BASELINE_META_KEY } from '@/src/config/firestore';
import { getFirestoreAdmin } from './firestore';
import { stripUndefinedDeep } from './normalization';
import type { CacheMetaDoc, FacilityDoc, JobDoc, JobType, RideCacheDoc, SigunguIndexDoc } from '@/types/domain';

function sanitizeForFirestoreWrite<T>(doc: T): T {
  return stripUndefinedDeep(doc);
}

export { BASELINE_META_KEY };

export async function upsertFacilities(facilities: FacilityDoc[]) {
  if (!facilities.length) return;
  const db = getFirestoreAdmin();
  const writer = db.bulkWriter();
  for (const facility of facilities) {
    writer.set(db.collection(COLLECTIONS.facilities).doc(facility.pfctSn), sanitizeForFirestoreWrite(facility), { merge: true });
  }
  await writer.close();
}

export async function getFacilitiesByRegion(sido: string, sigungu?: string) {
  const db = getFirestoreAdmin();
  let query = db.collection(COLLECTIONS.facilities).where('sido', '==', sido);
  if (sigungu) query = query.where('sigungu', '==', sigungu.replace(/\s+/g, ''));
  const snap = await query.get();
  return snap.docs.map((d) => d.data() as FacilityDoc);
}

export async function getAllFacilities() {
  const db = getFirestoreAdmin();
  const snap = await db.collection(COLLECTIONS.facilities).get();
  return snap.docs.map((d) => d.data() as FacilityDoc);
}

export async function getRideCaches(pfctSns: string[]) {
  if (!pfctSns.length) return [];
  const db = getFirestoreAdmin();
  const docs = await Promise.all(pfctSns.map((pfctSn) => db.collection(COLLECTIONS.rideCache).doc(pfctSn).get()));
  return docs.filter((d) => d.exists).map((d) => d.data() as RideCacheDoc);
}

export async function upsertRideCache(doc: RideCacheDoc) {
  const db = getFirestoreAdmin();
  await db.collection(COLLECTIONS.rideCache).doc(doc.pfctSn).set(sanitizeForFirestoreWrite(doc), { merge: true });
}

export async function setCacheMeta(regionKey: string, meta: Partial<CacheMetaDoc>) {
  const db = getFirestoreAdmin();
  await db.collection(COLLECTIONS.cacheMeta).doc(regionKey).set(sanitizeForFirestoreWrite(meta), { merge: true });
}

export async function getCacheMeta(regionKey: string) {
  const db = getFirestoreAdmin();
  const snap = await db.collection(COLLECTIONS.cacheMeta).doc(regionKey).get();
  return snap.exists ? (snap.data() as CacheMetaDoc) : null;
}

export async function setSigunguIndex(sido: string, sigungu: string[]) {
  const db = getFirestoreAdmin();
  const doc: SigunguIndexDoc = { sido, sigungu, updatedAt: new Date().toISOString() };
  await db.collection(COLLECTIONS.sigunguIndex).doc(sido).set(sanitizeForFirestoreWrite(doc), { merge: true });
}

export async function rebuildSigunguIndexFromFacilities() {
  await clearCollection(COLLECTIONS.sigunguIndex);
  const facilities = await getAllFacilities();
  const m = new Map<string, Set<string>>();
  facilities.forEach((x) => {
    if (!x.sido) return;
    if (!m.has(x.sido)) m.set(x.sido, new Set());
    if (x.sigungu) m.get(x.sido)?.add(x.sigungu);
  });
  for (const [sido, set] of m.entries()) await setSigunguIndex(sido, [...set].sort());
}

export async function getSigunguBySido(sido: string) {
  const db = getFirestoreAdmin();
  const doc = await db.collection(COLLECTIONS.sigunguIndex).doc(sido).get();
  if (!doc.exists) return [];
  return ((doc.get('sigungu') as string[] | undefined) ?? []).sort();
}

export async function getCollectionCounts() {
  const db = getFirestoreAdmin();
  const [facilities, rideCache, cacheMeta, sigunguIndex, jobs] = await Promise.all([
    db.collection(COLLECTIONS.facilities).count().get(),
    db.collection(COLLECTIONS.rideCache).count().get(),
    db.collection(COLLECTIONS.cacheMeta).count().get(),
    db.collection(COLLECTIONS.sigunguIndex).count().get(),
    db.collection(COLLECTIONS.jobs).count().get(),
  ]);
  return { facilities: facilities.data().count, rideCache: rideCache.data().count, cacheMeta: cacheMeta.data().count, sigunguIndex: sigunguIndex.data().count, jobs: jobs.data().count };
}

export async function getLatestCacheMeta() {
  const db = getFirestoreAdmin();
  const snap = await db.collection(COLLECTIONS.cacheMeta).orderBy('lastBuiltAt', 'desc').limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as CacheMetaDoc);
}

export async function createJob(type: JobType) {
  const db = getFirestoreAdmin();
  const ref = db.collection(COLLECTIONS.jobs).doc();
  const now = new Date().toISOString();
  const job: JobDoc = { jobId: ref.id, type, status: 'queued', startedAt: now, updatedAt: now, currentStage: 'queued', currentPage: 1, pagesFetched: 0, rawFacilityCount: 0, filteredFacilityCount: 0, successCount: 0, errorCount: 0, stopRequested: false, lastError: null, resultSummary: null };
  await ref.set(sanitizeForFirestoreWrite(job));
  return job;
}

export async function getLatestJob(type?: JobType) {
  const db = getFirestoreAdmin();
  const q = type ? db.collection(COLLECTIONS.jobs).where('type', '==', type).orderBy('startedAt', 'desc').limit(1) : db.collection(COLLECTIONS.jobs).orderBy('startedAt', 'desc').limit(1);
  const snap = await q.get();
  return snap.empty ? null : (snap.docs[0].data() as JobDoc);
}

export async function getJobById(jobId: string) {
  const db = getFirestoreAdmin();
  const snap = await db.collection(COLLECTIONS.jobs).doc(jobId).get();
  return snap.exists ? (snap.data() as JobDoc) : null;
}

export async function requestStopJob(jobId: string) {
  const db = getFirestoreAdmin();
  await db.collection(COLLECTIONS.jobs).doc(jobId).set({ stopRequested: true, updatedAt: new Date().toISOString() }, { merge: true });
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

export async function getFacilityByPfctSn(pfctSn: string) {
  const db = getFirestoreAdmin();
  const [facility, ride] = await Promise.all([
    db.collection(COLLECTIONS.facilities).doc(pfctSn).get(),
    db.collection(COLLECTIONS.rideCache).doc(pfctSn).get(),
  ]);
  return {
    facility: facility.exists ? (facility.data() as FacilityDoc) : null,
    ride: ride.exists ? (ride.data() as RideCacheDoc) : null,
  };
}
