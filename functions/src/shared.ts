import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const PUBLIC_DATA_SERVICE_KEY = defineSecret('PUBLIC_DATA_SERVICE_KEY');
export const PFCT_URL = 'https://apis.data.go.kr/1741000/pfc3/getPfctInfo3';
export const RIDE_URL = 'https://apis.data.go.kr/1741000/ride4/getRide4';
export const EXFC_URL = 'https://apis.data.go.kr/1741000/exfc5/getExfc5';
export const INSTALL_PLACES = ['A003', 'A022', 'A033'] as const;
export const RIDE_WHITELIST = new Set(['D001', 'D002', 'D003', 'D004', 'D005', 'D006', 'D007', 'D008', 'D009', 'D020', 'D021', 'D022', 'D080', 'D050', 'D052']);

export const BASELINE_INVOCATION_PAGE_BUDGET = 8;
export const ZERO_PAGE_LIMIT = 1;
export const BASELINE_FILTERED_ZERO_STREAK_LIMIT = 10;
export const PARSER_DEBUG_VERSION = 'baseline-filter-v2';

export const nowIso = () => new Date().toISOString();

function pick(raw: Record<string, unknown>, keys: string[]) { for (const k of keys) if (raw[k] !== undefined && raw[k] !== null) return raw[k]; return undefined; }
function num(v: unknown) { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : undefined; }
function txt(v: unknown) { const s = String(v ?? '').trim(); return s || undefined; }

const SIDO_ALIAS_MAP: Record<string, string> = {
  서울: '서울특별시',
  부산: '부산광역시',
  대구: '대구광역시',
  인천: '인천광역시',
  광주: '광주광역시',
  대전: '대전광역시',
  울산: '울산광역시',
  세종: '세종특별자치시',
  경기: '경기도',
  강원: '강원특별자치도',
  충북: '충청북도',
  충남: '충청남도',
  전북: '전북특별자치도',
  전남: '전라남도',
  경북: '경상북도',
  경남: '경상남도',
  제주: '제주특별자치도',
};

function compact(input: string) {
  return input.replace(/\s+/g, '');
}

export function normalizeSido(input: unknown) {
  const value = String(input ?? '').trim();
  if (!value) return '';
  if (SIDO_ALIAS_MAP[value]) return SIDO_ALIAS_MAP[value];

  const compactValue = compact(value);
  const aliasHit = Object.entries(SIDO_ALIAS_MAP).find(([alias, full]) => compact(alias) === compactValue || compact(full) === compactValue);
  if (aliasHit) return aliasHit[1];

  return value;
}

function parseItems(body: unknown): { items: Record<string, unknown>[]; parsePathUsed: string } {
  if (!body || typeof body !== 'object') return { items: [], parsePathUsed: 'none' };
  const b = body as Record<string, unknown>;
  const items = b.items;
  if (Array.isArray(items)) return { items: items as Record<string, unknown>[], parsePathUsed: 'body.items(array)' };
  if (items && typeof items === 'object') {
    const nested = (items as Record<string, unknown>).item;
    if (Array.isArray(nested)) return { items: nested as Record<string, unknown>[], parsePathUsed: 'body.items.item(array)' };
    if (nested && typeof nested === 'object') return { items: [nested as Record<string, unknown>], parsePathUsed: 'body.items.item(object)' };
  }
  const direct = b.item;
  if (Array.isArray(direct)) return { items: direct as Record<string, unknown>[], parsePathUsed: 'body.item(array)' };
  if (direct && typeof direct === 'object') return { items: [direct as Record<string, unknown>], parsePathUsed: 'body.item(object)' };
  return { items: [], parsePathUsed: 'none' };
}

export async function callApi(fullUrl: string, params: Record<string, string | number>, key: string) {
  const attempts: string[] = [];
  const keyCandidates = [key, encodeURIComponent(key)].filter((v, i, arr) => arr.indexOf(v) === i);
  let lastStatus = 0;
  let lastText = '';
  for (const candidate of keyCandidates) {
    const url = new URL(fullUrl);
    url.searchParams.set('serviceKey', candidate);
    url.searchParams.set('_type', 'json');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), { cache: 'no-store' });
    attempts.push(`${candidate === key ? 'raw' : 'encoded'}:${res.status}`);
    lastStatus = res.status;
    if (!res.ok) { lastText = await res.text(); continue; }
    const json = await res.json() as { response?: { body?: Record<string, unknown> & { totalPageCnt?: number } } };
    const parsed = parseItems(json?.response?.body);
    return {
      list: parsed.items,
      totalPages: Number(json?.response?.body?.totalPageCnt || 0) || null,
      parsePathUsed: parsed.parsePathUsed,
    };
  }
  throw new Error(`public api failed status=${lastStatus} attempts=${attempts.join(',')} detail=${lastText.slice(0, 300)}`);
}

export function extractRegionFromRaw(raw: Record<string, unknown>) {
  const address = txt(pick(raw, ['rdnmadr', 'lnmadr', 'ronaAddr', 'addr', 'detailAddr', 'address', '소재지도로명주소', '소재지지번주소'])) ?? '';
  const addressTokens = address.split(/\s+/).filter(Boolean);

  const sidoCandidates = [
    txt(pick(raw, ['sidoNm', 'sido', '시도', 'ctprvnNm', 'ctprvnNmCdNm', 'rgnNm', 'region'])),
    txt(pick(raw, ['sigunguNm', 'signguNm', 'sggNm'])),
    addressTokens[0],
  ].filter((value): value is string => Boolean(value));

  const sigunguCandidate = txt(pick(raw, ['sigungu', '시군구', 'signguNm', 'sigunguNm', 'sggNm', 'signguNmCdNm', 'district', 'county'])) ?? addressTokens[1] ?? '';

  const normalizedSidoCandidates = [...new Set(sidoCandidates.map((candidate) => normalizeSido(candidate)).filter(Boolean))];

  return {
    address,
    rawSidoCandidates: [...new Set(sidoCandidates)],
    normalizedSidoCandidates,
    sigungu: sigunguCandidate.replace(/\s+/g, ''),
    selectedSido: normalizedSidoCandidates[0] ?? '',
  };
}

export type BaselineFailureReason =
  | 'missing-sido'
  | 'installPlace-mismatch'
  | 'sido-mismatch'
  | 'invalid-pfctSn'
  | 'empty-address'
  | 'parser-zero-items';

export function normalizeFacility(raw: Record<string, unknown>, isExcellent: boolean) {
  const region = extractRegionFromRaw(raw);
  const pfctSn = String(pick(raw, ['pfctSn', '시설일련번호']) ?? '').trim();
  if (!pfctSn || !region.selectedSido) return null;

  const areaValue = num(pick(raw, ['ar', '면적']));
  const normalized = {
    pfctSn,
    facilityName: txt(pick(raw, ['pfctNm', '시설명'])) ?? '이름없음',
    installPlaceCode: String(pick(raw, ['inslPlcSeCd'])) || 'A003',
    address: region.address,
    normalizedAddress: region.address.replace(/\s+/g, ' ').trim(),
    sido: region.selectedSido,
    sigungu: region.sigungu,
    installYear: num(pick(raw, ['instlYy', '설치연도'])),
    area: areaValue ?? 400,
    areaMissing: areaValue === undefined,
    lat: num(pick(raw, ['latitude', 'lat', '위도'])),
    lng: num(pick(raw, ['longitude', 'lng', '경도'])),
    isExcellent,
    updatedAt: nowIso(),
  } as Record<string, unknown>;
  return { ...normalized, contentHash: computeFacilityHash(normalized) };
}

export function computeFacilityHash(doc: Record<string, unknown>) {
  return createHash('sha1').update(JSON.stringify({ pfctSn: doc.pfctSn, facilityName: doc.facilityName, installPlaceCode: doc.installPlaceCode, normalizedAddress: doc.normalizedAddress, sido: doc.sido, sigungu: doc.sigungu, installYear: doc.installYear ?? null, area: doc.area, lat: doc.lat ?? null, lng: doc.lng ?? null, isExcellent: doc.isExcellent })).digest('hex');
}

export async function clearFacilitiesBySido(sido: string) {
  while (true) {
    const snap = await db.collection('facilities').where('sido', '==', sido).limit(400).get();
    if (snap.empty) break;
    const writer = db.bulkWriter();
    snap.docs.forEach((d) => writer.delete(d.ref));
    await writer.close();
  }
}
