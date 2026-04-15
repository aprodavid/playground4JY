import { baselineMetaKey, COLLECTIONS, RIDE_META_KEY } from '@/src/config/firestore';
import { getFirestoreAdmin } from './firestore';
import { stripUndefinedDeep } from './normalization';
import type { BaselineMetaDoc, FacilityDoc, RideCacheDoc, RideMetaDoc, SigunguIndexDoc } from '@/types/domain';

function sanitizeForFirestoreWrite<T>(doc: T): T {
  return stripUndefinedDeep(doc);
}

export { baselineMetaKey, RIDE_META_KEY };

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

export async function getFacilitiesBySido(sido: string) {
  return getFacilitiesByRegion(sido);
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

export async function setCacheMeta(regionKey: string, meta: Record<string, unknown>) {
  const db = getFirestoreAdmin();
  await db.collection(COLLECTIONS.cacheMeta).doc(regionKey).set(sanitizeForFirestoreWrite(meta), { merge: true });
}

export async function getBaselineMeta(sido: string) {
  const db = getFirestoreAdmin();
  const key = baselineMetaKey(sido);
  const snap = await db.collection(COLLECTIONS.cacheMeta).doc(key).get();
  return snap.exists ? (snap.data() as BaselineMetaDoc) : null;
}

export async function getRideMeta() {
  const db = getFirestoreAdmin();
  const snap = await db.collection(COLLECTIONS.cacheMeta).doc(RIDE_META_KEY).get();
  return snap.exists ? (snap.data() as RideMetaDoc) : null;
}

export async function setSigunguIndex(sido: string, sigungu: string[]) {
  const db = getFirestoreAdmin();
  const doc: SigunguIndexDoc = { sido, sigungu, updatedAt: new Date().toISOString() };
  await db.collection(COLLECTIONS.sigunguIndex).doc(sido).set(sanitizeForFirestoreWrite(doc), { merge: true });
}

export async function getSigunguBySido(sido: string) {
  const db = getFirestoreAdmin();
  const doc = await db.collection(COLLECTIONS.sigunguIndex).doc(sido).get();
  if (!doc.exists) return [];
  return ((doc.get('sigungu') as string[] | undefined) ?? []).sort();
}

export async function getCollectionCounts() {
  const db = getFirestoreAdmin();
  const [facilities, rideCache, cacheMeta, sigunguIndex] = await Promise.all([
    db.collection(COLLECTIONS.facilities).count().get(),
    db.collection(COLLECTIONS.rideCache).count().get(),
    db.collection(COLLECTIONS.cacheMeta).count().get(),
    db.collection(COLLECTIONS.sigunguIndex).count().get(),
  ]);
  return { facilities: facilities.data().count, rideCache: rideCache.data().count, cacheMeta: cacheMeta.data().count, sigunguIndex: sigunguIndex.data().count };
}

export async function clearFacilitiesBySido(sido: string) {
  const db = getFirestoreAdmin();
  while (true) {
    const snap = await db.collection(COLLECTIONS.facilities).where('sido', '==', sido).limit(400).get();
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
