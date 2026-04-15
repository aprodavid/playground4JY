import { KOREA_SIDO_LIST } from '@/src/config/regions';
import type { FacilityDoc } from '@/types/domain';
import type { InstallPlaceCode } from '@/src/config/installPlaces';

function parseNumber(input: unknown): number | undefined {
  if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
  if (typeof input === 'string') {
    const normalized = input.replace(/,/g, '').trim();
    if (!normalized) return undefined;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parseText(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const normalized = input.trim();
  return normalized ? normalized : undefined;
}

function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, ' ').trim();
}

function addressSpecificity(address: string): number {
  return address.split(' ').length;
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefinedDeep(item)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

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

function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

export function normalizeSido(input?: string): string {
  const value = parseText(input);
  if (!value) return '';

  if (SIDO_ALIAS_MAP[value]) return SIDO_ALIAS_MAP[value];

  const compactValue = compact(value);
  const exact = KOREA_SIDO_LIST.find((sido) => compact(sido) === compactValue);
  if (exact) return exact;

  const fromPrefix = Object.entries(SIDO_ALIAS_MAP).find(([, full]) => compact(full).startsWith(compactValue));
  if (fromPrefix) return fromPrefix[1];

  return value;
}

export function normalizeSigungu(input?: string): string {
  const value = parseText(input);
  if (!value) return '';
  return value.replace(/\s+/g, '');
}

function firstAddressToken(address: string): string | undefined {
  const first = parseText(address)?.split(' ')[0];
  return parseText(first);
}

function secondAddressToken(address: string): string | undefined {
  return parseText(address.split(' ').slice(1, 2)[0]);
}

function getField(raw: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    if (raw[alias] !== undefined && raw[alias] !== null) return raw[alias];
  }
  return undefined;
}

export function extractRegionFromRaw(raw: Record<string, unknown>) {
  const address = parseText(getField(raw, ['rdnmadr', 'lnmadr', 'addr', 'detailAddr', 'address', '소재지도로명주소', '소재지지번주소'])) ?? '';

  const explicitSido = parseText(getField(raw, ['sido', '시도', 'ctprvnNm', 'ctprvnNmCdNm', 'rgnNm', 'region']));
  const explicitSigungu = parseText(getField(raw, ['sigungu', '시군구', 'signguNm', 'sigunguNm', 'sggNm', 'signguNmCdNm', 'district', 'county']));

  const sidoCandidate = explicitSido ?? firstAddressToken(address) ?? '';
  const sigunguCandidate = explicitSigungu ?? secondAddressToken(address) ?? '';

  return {
    sido: normalizeSido(sidoCandidate),
    sigungu: normalizeSigungu(sigunguCandidate),
    address,
    rawSido: sidoCandidate,
    rawSigungu: sigunguCandidate,
  };
}

export function matchesSelectedRegion(raw: Record<string, unknown>, sido: string, sigungu?: string): boolean {
  const region = extractRegionFromRaw(raw);
  if (!region.sido || !normalizeSido(sido)) return false;
  if (normalizeSido(region.sido) !== normalizeSido(sido)) return false;
  if (sigungu && normalizeSigungu(region.sigungu) !== normalizeSigungu(sigungu)) return false;
  return true;
}

function normalizeInstallPlaceCode(input: unknown): InstallPlaceCode {
  const raw = String(input ?? '').trim();
  if (raw === 'A022' || raw === 'A033' || raw === 'A003') return raw;
  return 'A003';
}

export function toFacilityDoc(raw: Record<string, unknown>, isExcellent: boolean): FacilityDoc {
  const areaValue = parseNumber(getField(raw, ['ar', 'area', '면적']));
  const areaMissing = areaValue === undefined;

  const region = extractRegionFromRaw(raw);
  const installYear = parseNumber(getField(raw, ['instlYy', 'installYear', '설치연도']));
  const lat = parseNumber(getField(raw, ['latitude', 'lat', '위도']));
  const lng = parseNumber(getField(raw, ['longitude', 'lng', '경도']));
  const pfctSn = String(getField(raw, ['pfctSn', 'pfct_sn', '시설일련번호', '시설번호']) ?? '').trim();

  return stripUndefinedDeep({
    pfctSn,
    facilityName: parseText(getField(raw, ['pfctNm', 'facilityName', '시설명'])) ?? '이름없음',
    sido: region.sido,
    sigungu: region.sigungu,
    address: region.address,
    normalizedAddress: normalizeAddress(region.address),
    lat,
    lng,
    installPlaceCode: normalizeInstallPlaceCode(getField(raw, ['inslPlcSeCd', 'installPlaceCode', '설치장소코드'])),
    installYear,
    area: areaValue ?? 400,
    areaMissing,
    isExcellent,
    updatedAt: new Date().toISOString(),
  });
}

export function dedupeByCoordinate<T extends { lat?: number; lng?: number; pfctSn: string; address?: string }>(input: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const f of input) {
    const key = f.lat !== undefined && f.lng !== undefined ? `${f.lat.toFixed(6)}:${f.lng.toFixed(6)}` : `no:${f.pfctSn}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const selected: T[] = [];
  for (const candidates of groups.values()) {
    const picked = candidates.sort((a, b) => {
      const specificityDiff = addressSpecificity(b.address ?? '') - addressSpecificity(a.address ?? '');
      if (specificityDiff !== 0) return specificityDiff;
      return a.pfctSn.localeCompare(b.pfctSn);
    })[0];
    selected.push(picked);
  }

  return selected;
}

export function parseUploadText(fileName: string, text: string): Record<string, unknown>[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) {
    const json = JSON.parse(text) as unknown;
    if (Array.isArray(json)) return json as Record<string, unknown>[];
    if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      if (Array.isArray(obj.items)) return obj.items as Record<string, unknown>[];
      if (obj.response && typeof obj.response === 'object') {
        const maybeItems = (obj.response as { body?: { items?: { item?: unknown } } }).body?.items?.item;
        if (Array.isArray(maybeItems)) return maybeItems as Record<string, unknown>[];
        if (maybeItems && typeof maybeItems === 'object') return [maybeItems as Record<string, unknown>];
      }
    }
    return [];
  }

  if (lower.endsWith('.csv')) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= 1) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      const values = splitCsvLine(line);
      const row: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        row[h.trim()] = values[idx]?.trim() ?? '';
      });
      return row;
    });
  }

  throw new Error('지원하지 않는 파일 형식입니다. JSON 또는 CSV 파일을 사용하세요.');
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (char === ',' && !inQuote) {
      cols.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cols.push(current);
  return cols;
}
