import { getFirestoreAdmin } from './firestore';
import { stripUndefinedDeep } from './normalization';
import type { CacheMetaDoc, FacilityDoc, RideCacheDoc } from '@/types/domain';

function sanitizeForFirestoreWrite<T>(doc: T): T {
  return stripUndefinedDeep(doc);
}

export const BASELINE_META_KEY = 'baseline:global';
const PFC3_UPLOAD_COLLECTION = 'baselineUploadPfc3';
const EXFC5_UPLOAD_COLLECTION = 'baselineUploadExfc5';

export async function upsertFacilities(facilities: FacilityDoc[]) {
  if (facilities.length === 0) return;
  const db = getFirestoreAdmin();
  for (let i = 0; i < facilities.length; i += 400) {
    const batch = db.batch();
    facilities.slice(i, i + 400).forEach((f) => {
      batch.set(db.collection('facilities').doc(String(f.pfctSn)), sanitizeForFirestoreWrite(f), { merge: true });
    });
    await batch.commit();
  }
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
