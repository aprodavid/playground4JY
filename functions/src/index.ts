import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';

initializeApp();
const db = getFirestore();

const PUBLIC_DATA_BASE_URL = defineString('PUBLIC_DATA_BASE_URL');
const PUBLIC_DATA_SERVICE_KEY = defineSecret('PUBLIC_DATA_SERVICE_KEY');

const INSTALL_PLACES = ['A003', 'A022', 'A033'] as const;

type JobDoc = Record<string, any> & { jobId: string; type: 'baseline' | 'ride'; status: string; currentPage?: number; cursor?: Record<string, unknown> };

function normalizeSido(input?: string) {
  if (!input) return '';
  const compact = input.replace(/\s+/g, '');
  const map: Record<string, string> = { 서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도' };
  if (map[input]) return map[input];
  for (const [k, v] of Object.entries(map)) if (v.replace(/\s+/g, '') === compact) return v;
  return input;
}

function normalizeSigungu(input?: string) { return (input ?? '').replace(/\s+/g, ''); }

function pick(raw: Record<string, unknown>, keys: string[]) { for (const k of keys) if (raw[k] !== undefined && raw[k] !== null) return raw[k]; return undefined; }
function num(v: unknown) { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : undefined; }
function txt(v: unknown) { const s = String(v ?? '').trim(); return s || undefined; }

function normalizeFacility(raw: Record<string, unknown>, isExcellent: boolean) {
  const address = txt(pick(raw, ['rdnmadr', 'lnmadr', 'addr', 'detailAddr', 'address', '소재지도로명주소', '소재지지번주소'])) ?? '';
  const tokens = address.split(' ').filter(Boolean);
  const sido = normalizeSido(txt(pick(raw, ['sido', '시도'])) ?? tokens[0] ?? '');
  const sigungu = normalizeSigungu(txt(pick(raw, ['sigungu', '시군구'])) ?? tokens[1] ?? '');
  const pfctSn = Number(pick(raw, ['pfctSn', '시설일련번호']));
  if (!Number.isFinite(pfctSn) || !sido) return null;

  return {
    pfctSn,
    facilityName: txt(pick(raw, ['pfctNm', '시설명'])) ?? '이름없음',
    installPlaceCode: String(pick(raw, ['inslPlcSeCd'])) || 'A003',
    address,
    sido,
    sigungu,
    installYear: num(pick(raw, ['instlYy', '설치연도'])),
    area: num(pick(raw, ['ar', '면적'])) ?? 400,
    lat: num(pick(raw, ['latitude', 'lat', '위도'])),
    lng: num(pick(raw, ['longitude', 'lng', '경도'])),
    isExcellent,
    updatedAt: new Date().toISOString(),
  };
}

async function callApi(endpoint: string, params: Record<string, string | number>, key: string) {
  const base = PUBLIC_DATA_BASE_URL.value().replace(/\/$/, '');
  const url = new URL(`${base}${endpoint}`);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('_type', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`public api status ${res.status}`);
  const json: any = await res.json();
  const body = json?.response?.body;
  const items = body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return { list, totalPages: Number(body?.totalPageCnt || 0) || null };
}

async function processBaseline(job: JobDoc, serviceKey: string) {
  const cursor = (job.cursor ?? {}) as { installPlaceIndex?: number; page?: number; excellentPage?: number; stage?: string; excellent?: number[] };
  const stage = cursor.stage ?? 'pfc3';
  const installPlaceIndex = cursor.installPlaceIndex ?? 0;
  const page = cursor.page ?? 1;

  if (stage === 'pfc3') {
    const installPlace = INSTALL_PLACES[installPlaceIndex];
    if (!installPlace) {
      await db.collection('jobs').doc(job.jobId).set({ cursor: { ...cursor, stage: 'exfc5', excellentPage: 1 }, currentStage: 'exfc5', currentPage: 1, currentInstallPlace: null, updatedAt: new Date().toISOString() }, { merge: true });
      return;
    }

    const fetched = await callApi('/pfc3/getPfctInfo3', { inslPlcSeCd: installPlace, pageIndex: page, recordCountPerPage: 200, pageNo: page, numOfRows: 200 }, serviceKey);
    const docs = fetched.list.map((r: Record<string, unknown>) => normalizeFacility(r, false)).filter(Boolean);
    const batch = db.batch();
    docs.forEach((doc: any) => batch.set(db.collection('facilities').doc(String(doc.pfctSn)), doc, { merge: true }));
    await batch.commit();

    const reachedEnd = fetched.totalPages ? page >= fetched.totalPages : fetched.list.length < 200;
    await db.collection('jobs').doc(job.jobId).set({
      status: 'running',
      currentStage: 'pfc3',
      currentInstallPlace: installPlace,
      currentPage: page,
      totalPages: fetched.totalPages,
      pagesFetched: (job.pagesFetched ?? 0) + 1,
      rawFacilityCount: (job.rawFacilityCount ?? 0) + fetched.list.length,
      filteredFacilityCount: (job.filteredFacilityCount ?? 0) + docs.length,
      successCount: (job.successCount ?? 0) + docs.length,
      cursor: { ...cursor, stage: 'pfc3', installPlaceIndex: reachedEnd ? installPlaceIndex + 1 : installPlaceIndex, page: reachedEnd ? 1 : page + 1 },
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return;
  }

  if (stage === 'exfc5') {
    const excellentPage = cursor.excellentPage ?? 1;
    const fetched = await callApi('/exfc5/getExfcInfo5', { pageIndex: excellentPage, recordCountPerPage: 200, pageNo: excellentPage, numOfRows: 200 }, serviceKey);
    const existing = new Set<number>((cursor.excellent ?? []) as number[]);
    fetched.list.forEach((row: any) => { const n = Number(row.pfctSn); if (Number.isFinite(n)) existing.add(n); });
    const reachedEnd = fetched.totalPages ? excellentPage >= fetched.totalPages : fetched.list.length < 200;

    await db.collection('jobs').doc(job.jobId).set({
      status: 'running',
      currentStage: 'exfc5',
      currentPage: excellentPage,
      totalPages: fetched.totalPages,
      pagesFetched: (job.pagesFetched ?? 0) + 1,
      cursor: { ...cursor, stage: reachedEnd ? 'finalize' : 'exfc5', excellentPage: reachedEnd ? 1 : excellentPage + 1, excellent: [...existing] },
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return;
  }

  const excellentSet = new Set<number>(((cursor.excellent ?? []) as number[]));
  const facilities = await db.collection('facilities').get();
  const sigunguMap = new Map<string, Set<string>>();
  const updateBatch = db.batch();
  facilities.docs.forEach((doc) => {
    const data = doc.data();
    if (excellentSet.has(Number(data.pfctSn)) && !data.isExcellent) updateBatch.set(doc.ref, { isExcellent: true, updatedAt: new Date().toISOString() }, { merge: true });
    if (data.sido) {
      if (!sigunguMap.has(data.sido)) sigunguMap.set(data.sido, new Set());
      if (data.sigungu) sigunguMap.get(data.sido)!.add(data.sigungu);
    }
  });
  await updateBatch.commit();
  for (const [sido, sigunguSet] of sigunguMap.entries()) {
    await db.collection('sigunguIndex').doc(sido).set({ sido, sigungu: [...sigunguSet].sort(), updatedAt: new Date().toISOString() }, { merge: true });
  }

  const finishedAt = new Date().toISOString();
  await db.collection('cacheMeta').doc('baseline:global').set({
    regionKey: 'baseline:global', baselineStatus: 'success', baselineSource: 'api-crawl', baselineUpdatedAt: finishedAt, baselineCurrentStage: 'completed', lastBuildStatus: 'ok', lastBuiltAt: finishedAt, status: 'success', done: true,
  }, { merge: true });

  await db.collection('jobs').doc(job.jobId).set({ status: 'success', currentStage: 'completed', updatedAt: finishedAt, resultSummary: { facilitiesCount: facilities.size, excellentCount: excellentSet.size } }, { merge: true });
}

async function processRide(job: JobDoc, serviceKey: string) {
  const snap = await db.collection('facilities').get();
  const seen = new Set<string>();
  const targets: number[] = [];
  snap.docs.forEach((d) => {
    const x = d.data();
    const key = x.lat && x.lng ? `${Number(x.lat).toFixed(6)}:${Number(x.lng).toFixed(6)}` : `pfct:${x.pfctSn}`;
    if (!seen.has(key)) { seen.add(key); targets.push(Number(x.pfctSn)); }
  });

  const cursor = (job.cursor ?? {}) as { offset?: number };
  const offset = cursor.offset ?? 0;
  const batchTargets = targets.slice(offset, offset + 40);

  let success = 0;
  let error = 0;
  for (const pfctSn of batchTargets) {
    try {
      const fetched = await callApi('/ride4/getRideInfo4', { pfctSn }, serviceKey);
      const types = [...new Set(fetched.list.map((x: any) => String(x.playkndCd)).filter(Boolean))];
      await db.collection('rideCache').doc(String(pfctSn)).set({ pfctSn, rawCount: fetched.list.length, filteredCount: fetched.list.length, typeCount: types.length, types, status: fetched.list.length ? 'ok' : 'empty', updatedAt: new Date().toISOString() }, { merge: true });
      success += 1;
    } catch (e) {
      await db.collection('rideCache').doc(String(pfctSn)).set({ pfctSn, rawCount: 0, filteredCount: 0, typeCount: 0, types: [], status: 'error', updatedAt: new Date().toISOString(), lastError: e instanceof Error ? e.message : 'unknown error' }, { merge: true });
      error += 1;
    }
  }

  const done = offset + batchTargets.length >= targets.length;
  const now = new Date().toISOString();
  await db.collection('jobs').doc(job.jobId).set({
    status: done ? 'success' : 'running',
    currentStage: done ? 'completed' : 'ride-batch',
    currentPage: offset + batchTargets.length,
    totalPages: targets.length,
    successCount: (job.successCount ?? 0) + success,
    errorCount: (job.errorCount ?? 0) + error,
    cursor: { offset: offset + batchTargets.length },
    updatedAt: now,
  }, { merge: true });

  await db.collection('cacheMeta').doc('baseline:global').set({
    rideStatus: done ? 'success' : 'running',
    rideUpdatedAt: now,
  }, { merge: true });
}

async function processOneJob() {
  const snap = await db.collection('jobs').where('status', 'in', ['queued', 'running']).orderBy('startedAt', 'asc').limit(1).get();
  if (snap.empty) return { processed: false };

  const doc = snap.docs[0];
  const job = doc.data() as JobDoc;
  if (job.stopRequested) {
    await doc.ref.set({ status: 'stopped', updatedAt: new Date().toISOString(), currentStage: 'stopped' }, { merge: true });
    return { processed: true, stopped: true };
  }

  const secret = PUBLIC_DATA_SERVICE_KEY.value();
  try {
    if (job.type === 'baseline') await processBaseline({ ...job, jobId: doc.id }, secret);
    if (job.type === 'ride') await processRide({ ...job, jobId: doc.id }, secret);
    return { processed: true, jobId: doc.id, type: job.type };
  } catch (error) {
    await doc.ref.set({ status: 'error', lastError: error instanceof Error ? error.message : 'unknown error', updatedAt: new Date().toISOString(), errorCount: (job.errorCount ?? 0) + 1 }, { merge: true });
    throw error;
  }
}

export const workerTick = onSchedule({ schedule: 'every 2 minutes', region: 'asia-northeast3', secrets: [PUBLIC_DATA_SERVICE_KEY] }, async () => {
  await processOneJob();
});

export const workerKick = onRequest({ region: 'asia-northeast3', secrets: [PUBLIC_DATA_SERVICE_KEY] }, async (_req, res) => {
  const result = await processOneJob();
  res.status(200).json(result);
});
