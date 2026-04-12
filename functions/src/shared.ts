import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';

if (!getApps().length) {
  initializeApp();
}

export const db = getFirestore();

export const PUBLIC_DATA_SERVICE_KEY = defineSecret('PUBLIC_DATA_SERVICE_KEY');
export const BASE_URL = 'http://apis.data.go.kr/1741000/';
export const INSTALL_PLACES = ['A003', 'A022', 'A033'] as const;
export const BASELINE_STEP_BUDGET = 2;
export const RIDE_STEP_TARGETS = 40;

export type NormalizedFacility = Record<string, unknown> & { contentHash: string; pfctSn: number };
export type JobType = 'baseline' | 'ride';
export type JobStatus = 'queued' | 'running' | 'success' | 'error' | 'stopped';

export type JobDoc = {
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
    initialized?: boolean;
    scannedTargets?: number;
  };
};

export function nowIso() {
  return new Date().toISOString();
}

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

export function computeFacilityHash(doc: Record<string, unknown>) {
  const payload = JSON.stringify({
    pfctSn: doc.pfctSn,
    facilityName: doc.facilityName,
    installPlaceCode: doc.installPlaceCode,
    normalizedAddress: doc.normalizedAddress,
    sido: doc.sido,
    sigungu: doc.sigungu,
    installYear: doc.installYear ?? null,
    area: doc.area,
    lat: doc.lat ?? null,
    lng: doc.lng ?? null,
    isExcellent: doc.isExcellent,
  });
  return createHash('sha1').update(payload).digest('hex');
}

export function normalizeFacility(raw: Record<string, unknown>, isExcellent: boolean) {
  const address = txt(pick(raw, ['rdnmadr', 'lnmadr', 'addr', 'detailAddr', 'address', '소재지도로명주소', '소재지지번주소'])) ?? '';
  const tokens = address.split(' ').filter(Boolean);
  const sido = normalizeSido(txt(pick(raw, ['sido', '시도'])) ?? tokens[0] ?? '');
  const sigungu = normalizeSigungu(txt(pick(raw, ['sigungu', '시군구'])) ?? tokens[1] ?? '');
  const pfctSn = Number(pick(raw, ['pfctSn', '시설일련번호']));
  if (!Number.isFinite(pfctSn) || !sido) return null;

  const normalized = {
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
    updatedAt: nowIso(),
  } as Record<string, unknown>;

  return {
    ...normalized,
    contentHash: computeFacilityHash(normalized),
  };
}

export async function callApi(endpoint: string, params: Record<string, string | number>, key: string) {
  const base = BASE_URL;
  const normalizedBase = String(base ?? '').trim().replace(/\/+$/, '/');
  const normalizedEndpoint = String(endpoint ?? '').trim().replace(/^\/+/, '');
  const serviceKey = String(key ?? '').trim();

  if (!normalizedBase) {
    console.error('Invalid BASE_URL: BASE_URL is empty or undefined.', {
      endpoint,
      paramKeys: Object.keys(params),
    });
    throw new Error('Invalid BASE_URL');
  }

  if (!serviceKey) {
    console.error('Missing Environment Variable: PUBLIC_DATA_SERVICE_KEY is empty or undefined.', {
      endpoint,
      paramKeys: Object.keys(params),
    });
    throw new Error('Missing Environment Variable: PUBLIC_DATA_SERVICE_KEY');
  }

  const attempts: string[] = [];
  const keyCandidates = [serviceKey, encodeURIComponent(serviceKey)].filter((v, i, arr) => arr.indexOf(v) === i);

  let lastStatus = 0;
  let lastText = '';
  for (const candidate of keyCandidates) {
    let url: URL;
    try {
      url = new URL(normalizedEndpoint, normalizedBase);
    } catch (error) {
      console.error('Invalid URL configuration.', {
        endpoint,
        base: normalizedBase,
        normalizedEndpoint,
        error: error instanceof Error ? error.message : 'unknown error',
      });
      throw new Error(`Invalid BASE_URL or endpoint: base="${normalizedBase}" endpoint="${endpoint}"`);
    }
    url.searchParams.set('serviceKey', candidate);
    url.searchParams.set('_type', 'json');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    const res = await fetch(url.toString(), { cache: 'no-store' });
    attempts.push(`${candidate === key ? 'raw' : 'encoded'}:${res.status}`);
    lastStatus = res.status;
    if (!res.ok) {
      lastText = await res.text();
      continue;
    }

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

  throw new Error(`public api failed ${endpoint} status=${lastStatus} attempts=${attempts.join(',')} detail=${lastText.slice(0, 300)}`);
}

export async function clearCollection(name: string) {
  while (true) {
    const snap = await db.collection(name).limit(400).get();
    if (snap.empty) break;
    const writer = db.bulkWriter();
    snap.docs.forEach((d) => writer.delete(d.ref));
    await writer.close();
  }
}

export async function upsertFacilitiesWithDiff(facilities: Record<string, unknown>[]) {
  if (facilities.length === 0) return { writes: 0, skipped: 0 };
  const refs = facilities.map((f) => db.collection('facilities').doc(String(f.pfctSn)));
  const snapshots = await db.getAll(...refs);
  const existingMap = new Map<string, Record<string, unknown>>();
  snapshots.forEach((s) => { if (s.exists) existingMap.set(s.id, s.data() as Record<string, unknown>); });

  const writer = db.bulkWriter();
  let writes = 0;
  let skipped = 0;

  for (const facility of facilities) {
    const id = String(facility.pfctSn);
    const existing = existingMap.get(id);
    if (existing?.contentHash && existing.contentHash === facility.contentHash) {
      skipped += 1;
      continue;
    }
    writer.set(db.collection('facilities').doc(id), facility, { merge: true });
    writes += 1;
  }

  await writer.close();
  return { writes, skipped };
}
