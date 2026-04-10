import { getFirestoreAdmin } from './firestore';
import { stripUndefinedDeep } from './normalization';
import type { CacheMetaDoc, FacilityDoc, RideCacheDoc } from '@/types/domain';

function sanitizeForFirestoreWrite<T>(doc: T): T {
  return stripUndefinedDeep(doc);
}

export const BASELINE_META_KEY = 'baseline:global';

export async function upsertFacilities(facilities: FacilityDoc[]) {
  if (facilities.length === 0) return;
  const db = getFirestoreAdmin();
  const batch = db.batch();
  facilities.forEach((f) => {
    batch.set(db.collection('facilities').doc(String(f.pfctSn)), sanitizeForFirestoreWrite(f), { merge: true });
  });
  await batch.commit();
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

export async function getSigunguBySido(sido: string) {
  const db = getFirestoreAdmin();
  const doc = await db.collection('sigunguIndex').doc(sido).get();
  if (doc.exists) {
    const list = (doc.get('sigungu') as string[] | undefined) ?? [];
    if (list.length > 0) return [...new Set(list)].sort();
  }

  const snap = await db.collection('facilities').where('sido', '==', sido).select('sigungu').get();
  return [...new Set(snap.docs.map((d) => String(d.get('sigungu') ?? '')).filter(Boolean))].sort();
}

export async function getCollectionCounts() {
  const db = getFirestoreAdmin();
  const [facilities, rideCache, cacheMeta, sigunguIndex] = await Promise.all([
    db.collection('facilities').count().get(),
    db.collection('rideCache').count().get(),
    db.collection('cacheMeta').count().get(),
    db.collection('sigunguIndex').count().get(),
  ]);

  return {
    facilities: facilities.data().count,
    rideCache: rideCache.data().count,
    cacheMeta: cacheMeta.data().count,
    sigunguIndex: sigunguIndex.data().count,
  };
}

export async function getLatestCacheMeta() {
  const db = getFirestoreAdmin();
  const snap = await db.collection('cacheMeta').orderBy('lastBuiltAt', 'desc').limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data() as CacheMetaDoc;
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
