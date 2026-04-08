import { db } from './firestore';
import type { FacilityDoc, RideCacheDoc } from '@/types/domain';

export async function upsertFacilities(facilities: FacilityDoc[]) {
  const batch = db.batch();
  facilities.forEach((f) => {
    batch.set(db.collection('facilities').doc(String(f.pfctSn)), f, { merge: true });
  });
  await batch.commit();
}

export async function getFacilitiesByRegion(sido: string, sigungu?: string) {
  let query = db.collection('facilities').where('sido', '==', sido);
  if (sigungu) query = query.where('sigungu', '==', sigungu);
  const snap = await query.get();
  return snap.docs.map((d) => d.data() as FacilityDoc);
}

export async function getRideCaches(pfctSns: number[]) {
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
  await db.collection('rideCache').doc(String(doc.pfctSn)).set(doc, { merge: true });
}

export async function setCacheMeta(regionKey: string, meta: Record<string, unknown>) {
  await db.collection('cacheMeta').doc(regionKey).set(meta, { merge: true });
}

export async function getFacilityByPfctSn(pfctSn: number) {
  const [facility, ride] = await Promise.all([
    db.collection('facilities').doc(String(pfctSn)).get(),
    db.collection('rideCache').doc(String(pfctSn)).get(),
  ]);
  return {
    facility: facility.exists ? (facility.data() as FacilityDoc) : null,
    ride: ride.exists ? (ride.data() as RideCacheDoc) : null,
  };
}
