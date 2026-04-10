import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();
const db = getFirestore();

const PUBLIC_DATA_BASE_URL = defineString('PUBLIC_DATA_BASE_URL');
const PUBLIC_DATA_SERVICE_KEY = defineSecret('PUBLIC_DATA_SERVICE_KEY');
const BASELINE_META_KEY = 'baseline:global';
const INSTALL_PLACES = ['A003', 'A022', 'A033'] as const;

type JobType = 'baseline' | 'ride';
type JobStatus = 'queued' | 'running' | 'success' | 'error' | 'stopped';

type JobDoc = {
  jobId: string;
  type: JobType;
  status: JobStatus;
  startedAt?: string;
  updatedAt?: string;
  stopRequested?: boolean;
  currentStage?: string | null;
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPages?: number | null;
  pagesFetched?: number;
  rawFacilityCount?: number;
  filteredFacilityCount?: number;
  successCount?: number;
  errorCount?: number;
  lastError?: string | null;
  resultSummary?: Record<string, unknown> | null;
  cursor?: {
    stage?: 'pfc3' | 'exfc5' | 'finalize';
    installPlaceIndex?: number;
    page?: number;
    excellentPage?: number;
    excellent?: number[];
    offset?: number;
    targets?: number[];
  };
};

function normalizeSido(input?: string) {
  if (!input) return '';
  const compact = input.replace(/\s+/g, '');
  const map: Record<string, string> = {
    서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시',
    대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도',
    충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도',
    경남: '경상남도', 제주: '제주특별자치도',
  };
  if (map[input]) return map[input];
  for (const [k, v] of Object.entries(map)) {
    if (v.replace(/\s+/g, '') === compact || k === compact) return v;
  }
  return input;
}

function normalizeSigungu(input?: string) {
  return (input ?? '').replace(/\s+/g, '');
}

function pick(raw: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return undefined;
}

function num(v: unknown) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function txt(v: unknown) {
  const s = String(v ?? '').trim();
  return s || undefined;
}

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
    normalizedAddress: address.replace(/\s+/g, ' ').trim(),
    sido,
    sigungu,
    installYear: num(pick(raw, ['instlYy', '설치연도'])),
    area: num(pick(raw, ['ar', '면적'])) ?? 400,
    areaMissing: num(pick(raw, ['ar', '면적'])) === undefined,
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
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`public api status ${res.status}`);
  const json = await res.json() as {
    response?: { body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] }; totalPageCnt?: number } };
  };
  const body = json?.response?.body;
  const items = body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];

  return {
    list,
    totalPages: Number(body?.totalPageCnt || 0) || null,
  };
}

async function upsertBaselineMeta(patch: Record<string, unknown>) {
  await db.collection('cacheMeta').doc(BASELINE_META_KEY).set({
    regionKey: BASELINE_META_KEY,
    ...patch,
  }, { merge: true });
}

async function processBaseline(job: JobDoc, serviceKey: string) {
  const cursor = job.cursor ?? {};
  const stage = cursor.stage ?? 'pfc3';

  if (stage === 'pfc3') {
    const installPlaceIndex = cursor.installPlaceIndex ?? 0;
    const page = cursor.page ?? 1;
    const installPlace = INSTALL_PLACES[installPlaceIndex];

    if (!installPlace) {
      await db.collection('jobs').doc(job.jobId).set({
        status: 'running',
        currentStage: 'exfc5',
        currentInstallPlace: null,
        currentPage: 1,
        cursor: { ...cursor, stage: 'exfc5', excellentPage: 1 },
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return;
    }

    const fetched = await callApi('/pfc3/getPfctInfo3', {
      inslPlcSeCd: installPlace,
      pageIndex: page,
      recordCountPerPage: 200,
      pageNo: page,
      numOfRows: 200,
    }, serviceKey);

    const normalized = fetched.list
      .map((r) => normalizeFacility(r, false))
      .filter((doc): doc is NonNullable<ReturnType<typeof normalizeFacility>> => doc !== null);

    for (let i = 0; i < normalized.length; i += 400) {
      const batch = db.batch();
      normalized.slice(i, i + 400).forEach((doc) => {
        batch.set(db.collection('facilities').doc(String(doc.pfctSn)), doc, { merge: true });
      });
      await batch.commit();
    }

    const reachedEnd = fetched.totalPages ? page >= fetched.totalPages : fetched.list.length < 200;
    const now = new Date().toISOString();
    await db.collection('jobs').doc(job.jobId).set({
      status: 'running',
      currentStage: 'pfc3',
      currentInstallPlace: installPlace,
      currentPage: page,
      totalPages: fetched.totalPages,
      pagesFetched: (job.pagesFetched ?? 0) + 1,
      rawFacilityCount: (job.rawFacilityCount ?? 0) + fetched.list.length,
      filteredFacilityCount: (job.filteredFacilityCount ?? 0) + normalized.length,
      successCount: (job.successCount ?? 0) + normalized.length,
      cursor: {
        ...cursor,
        stage: 'pfc3',
        installPlaceIndex: reachedEnd ? installPlaceIndex + 1 : installPlaceIndex,
        page: reachedEnd ? 1 : page + 1,
      },
      updatedAt: now,
    }, { merge: true });

    await upsertBaselineMeta({
      status: 'running',
      baselineStatus: 'running',
      baselineSource: 'api-crawl',
      baselineCurrentStage: 'pfc3',
      baselineCurrentInstallPlace: installPlace,
      baselineCurrentPage: page,
      baselineTotalPages: fetched.totalPages,
      baselinePagesFetched: (job.pagesFetched ?? 0) + 1,
      baselineRawFacilityCount: (job.rawFacilityCount ?? 0) + fetched.list.length,
      baselineFilteredFacilityCount: (job.filteredFacilityCount ?? 0) + normalized.length,
      baselineUpdatedAt: now,
      updatedAt: now,
      lastBuildStatus: 'ok',
      done: false,
    });
    return;
  }

  if (stage === 'exfc5') {
    const excellentPage = cursor.excellentPage ?? 1;
    const fetched = await callApi('/exfc5/getExfcInfo5', {
      pageIndex: excellentPage,
      recordCountPerPage: 200,
      pageNo: excellentPage,
      numOfRows: 200,
    }, serviceKey);

    const existing = new Set<number>((cursor.excellent ?? []));
    fetched.list.forEach((row) => {
      const n = Number(row.pfctSn);
      if (Number.isFinite(n)) existing.add(n);
    });
    const reachedEnd = fetched.totalPages ? excellentPage >= fetched.totalPages : fetched.list.length < 200;
    const now = new Date().toISOString();

    await db.collection('jobs').doc(job.jobId).set({
      status: 'running',
      currentStage: 'exfc5',
      currentPage: excellentPage,
      totalPages: fetched.totalPages,
      pagesFetched: (job.pagesFetched ?? 0) + 1,
      cursor: {
        ...cursor,
        stage: reachedEnd ? 'finalize' : 'exfc5',
        excellentPage: reachedEnd ? 1 : excellentPage + 1,
        excellent: [...existing],
      },
      updatedAt: now,
    }, { merge: true });

    await upsertBaselineMeta({
      status: 'running',
      baselineStatus: 'running',
      baselineCurrentStage: 'exfc5',
      baselineCurrentInstallPlace: null,
      baselineCurrentPage: excellentPage,
      baselineTotalPages: fetched.totalPages,
      baselinePagesFetched: (job.pagesFetched ?? 0) + 1,
      baselineUpdatedAt: now,
      updatedAt: now,
      done: false,
    });
    return;
  }

  const excellentSet = new Set<number>(cursor.excellent ?? []);
  const facilitiesSnap = await db.collection('facilities').get();
  const sigunguMap = new Map<string, Set<string>>();

  let updatedExcellent = 0;
  for (let i = 0; i < facilitiesSnap.docs.length; i += 400) {
    const batch = db.batch();
    facilitiesSnap.docs.slice(i, i + 400).forEach((doc) => {
      const data = doc.data();
      if (excellentSet.has(Number(data.pfctSn)) && !data.isExcellent) {
        batch.set(doc.ref, { isExcellent: true, updatedAt: new Date().toISOString() }, { merge: true });
        updatedExcellent += 1;
      }
      if (data.sido) {
        if (!sigunguMap.has(data.sido as string)) sigunguMap.set(data.sido as string, new Set());
        if (data.sigungu) sigunguMap.get(data.sido as string)?.add(String(data.sigungu));
      }
    });
    await batch.commit();
  }

  for (const [sido, sigunguSet] of sigunguMap.entries()) {
    await db.collection('sigunguIndex').doc(sido).set({
      sido,
      sigungu: [...sigunguSet].sort(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  const finishedAt = new Date().toISOString();
  await upsertBaselineMeta({
    status: 'success',
    baselineStatus: 'success',
    baselineSource: 'api-crawl',
    baselineCurrentStage: 'completed',
    baselineCurrentInstallPlace: null,
    baselineCurrentPage: 1,
    baselineUpdatedAt: finishedAt,
    facilitiesCount: facilitiesSnap.size,
    excellentCount: updatedExcellent,
    done: true,
    lastBuildStatus: 'ok',
    lastBuiltAt: finishedAt,
    updatedAt: finishedAt,
    lastError: null,
    baselineLastError: null,
  });

  await db.collection('jobs').doc(job.jobId).set({
    status: 'success',
    currentStage: 'completed',
    updatedAt: finishedAt,
    resultSummary: {
      facilitiesCount: facilitiesSnap.size,
      markedExcellentCount: updatedExcellent,
      sigunguIndexSidoCount: sigunguMap.size,
    },
  }, { merge: true });
}

async function loadRideTargets() {
  const snap = await db.collection('facilities').get();
  const seen = new Set<string>();
  const targets: number[] = [];
  snap.docs.forEach((d) => {
    const x = d.data();
    const key = x.lat && x.lng ? `${Number(x.lat).toFixed(6)}:${Number(x.lng).toFixed(6)}` : `pfct:${x.pfctSn}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push(Number(x.pfctSn));
    }
  });
  return targets;
}

async function processRide(job: JobDoc, serviceKey: string) {
  const now = new Date().toISOString();
  const targets = job.cursor?.targets ?? await loadRideTargets();
  const offset = job.cursor?.offset ?? 0;
  const batchTargets = targets.slice(offset, offset + 40);

  let success = 0;
  let error = 0;

  for (const pfctSn of batchTargets) {
    try {
      const fetched = await callApi('/ride4/getRideInfo4', { pfctSn }, serviceKey);
      const types = [...new Set(fetched.list.map((x) => String(x.playkndCd)).filter(Boolean))];
      await db.collection('rideCache').doc(String(pfctSn)).set({
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
      await db.collection('rideCache').doc(String(pfctSn)).set({
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

  const processed = offset + batchTargets.length;
  const done = processed >= targets.length;

  await db.collection('jobs').doc(job.jobId).set({
    status: done ? 'success' : 'running',
    currentStage: done ? 'completed' : 'ride-batch',
    currentPage: processed,
    totalPages: targets.length,
    pagesFetched: (job.pagesFetched ?? 0) + 1,
    successCount: (job.successCount ?? 0) + success,
    errorCount: (job.errorCount ?? 0) + error,
    cursor: {
      ...job.cursor,
      offset: processed,
      targets,
    },
    updatedAt: now,
  }, { merge: true });

  await upsertBaselineMeta({
    rideStatus: done ? 'success' : 'running',
    rideUpdatedAt: now,
    rideStartedAt: job.startedAt ?? now,
    rideProgress: {
      totalTargets: targets.length,
      processedTargets: processed,
      updatedTargets: (job.successCount ?? 0) + success,
      errorTargets: (job.errorCount ?? 0) + error,
      skippedExistingTargets: 0,
    },
    ...(done ? { lastBuiltAt: now } : {}),
  });
}

async function processOneJob() {
  const snap = await db.collection('jobs')
    .where('status', 'in', ['queued', 'running'])
    .orderBy('startedAt', 'asc')
    .limit(1)
    .get();

  if (snap.empty) {
    return { processed: false };
  }

  const doc = snap.docs[0];
  const job = { ...(doc.data() as JobDoc), jobId: doc.id };

  if (job.stopRequested) {
    const now = new Date().toISOString();
    await doc.ref.set({ status: 'stopped', updatedAt: now, currentStage: 'stopped' }, { merge: true });
    if (job.type === 'baseline') await upsertBaselineMeta({ baselineStatus: 'stopped', status: 'stopped', updatedAt: now, baselineUpdatedAt: now, done: true });
    if (job.type === 'ride') await upsertBaselineMeta({ rideStatus: 'stopped', rideUpdatedAt: now });
    return { processed: true, stopped: true, jobId: doc.id };
  }

  const secret = PUBLIC_DATA_SERVICE_KEY.value();
  const now = new Date().toISOString();

  if (job.status === 'queued') {
    await doc.ref.set({ status: 'running', currentStage: 'starting', updatedAt: now }, { merge: true });
    if (job.type === 'baseline') {
      await upsertBaselineMeta({
        status: 'running',
        baselineStatus: 'running',
        baselineSource: 'api-crawl',
        baselineStartedAt: job.startedAt ?? now,
        baselineUpdatedAt: now,
        baselineCurrentStage: 'starting',
        done: false,
        lastError: null,
        baselineLastError: null,
      });
    } else {
      await upsertBaselineMeta({
        rideStatus: 'running',
        rideStartedAt: job.startedAt ?? now,
        rideUpdatedAt: now,
        rideLastError: null,
      });
    }
  }

  try {
    if (job.type === 'baseline') await processBaseline(job, secret);
    if (job.type === 'ride') await processRide(job, secret);
    return { processed: true, jobId: doc.id, type: job.type };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'unknown error';
    await doc.ref.set({
      status: 'error',
      lastError: errMsg,
      updatedAt: new Date().toISOString(),
      errorCount: (job.errorCount ?? 0) + 1,
    }, { merge: true });
    if (job.type === 'baseline') {
      await upsertBaselineMeta({
        status: 'error',
        baselineStatus: 'error',
        baselineUpdatedAt: new Date().toISOString(),
        baselineLastError: errMsg,
        lastError: errMsg,
        done: true,
        lastBuildStatus: 'error',
      });
    } else {
      await upsertBaselineMeta({
        rideStatus: 'error',
        rideUpdatedAt: new Date().toISOString(),
        rideLastError: errMsg,
      });
    }
    throw error;
  }
}

export const workerTick = onSchedule({
  schedule: 'every 2 minutes',
  region: 'asia-northeast3',
  secrets: [PUBLIC_DATA_SERVICE_KEY],
}, async () => {
  await processOneJob();
});

export const workerKick = onRequest({
  region: 'asia-northeast3',
  secrets: [PUBLIC_DATA_SERVICE_KEY],
}, async (_req: unknown, res: { status: (code: number) => { json: (payload: unknown) => void } }) => {
  const result = await processOneJob();
  res.status(200).json(result);
});

export const onJobCreatedKick = onDocumentCreated({
  document: 'jobs/{jobId}',
  region: 'asia-northeast3',
  secrets: [PUBLIC_DATA_SERVICE_KEY],
}, async () => {
  await processOneJob();
});
