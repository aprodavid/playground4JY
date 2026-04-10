import { KOREA_SIDO_LIST, type FacilityDoc, type InstallPlaceCode } from '@/types/domain';

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

export function normalizeSidoName(input?: string): string {
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

function normalizeSigunguName(input?: string): string {
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

export function extractRegionFromRaw(raw: Record<string, unknown>) {
  const address = parseText(raw.rdnmadr) ?? parseText(raw.lnmadr) ?? parseText(raw.addr) ?? parseText(raw.detailAddr) ?? '';

  const sidoCandidate =
    parseText(raw.ctprvnNm) ??
    parseText(raw.ctprvnNmCdNm) ??
    parseText(raw.rgnNm) ??
    parseText(raw.region) ??
    firstAddressToken(address) ??
    '';

  const sigunguCandidate =
    parseText(raw.signguNm) ??
    parseText(raw.sigunguNm) ??
    parseText(raw.sggNm) ??
    parseText(raw.signguNmCdNm) ??
    parseText(raw.district) ??
    parseText(raw.county) ??
    secondAddressToken(address) ??
    '';

  return {
    sido: normalizeSidoName(sidoCandidate),
    sigungu: normalizeSigunguName(sigunguCandidate),
    address,
    rawSido: sidoCandidate,
    rawSigungu: sigunguCandidate,
  };
}

export function matchesSelectedRegion(raw: Record<string, unknown>, sido: string, sigungu?: string): boolean {
  const region = extractRegionFromRaw(raw);
  if (!region.sido || !normalizeSidoName(sido)) return false;
  if (normalizeSidoName(region.sido) !== normalizeSidoName(sido)) return false;
  if (sigungu && normalizeSigunguName(region.sigungu) !== normalizeSigunguName(sigungu)) return false;
  return true;
}

export function toFacilityDoc(raw: Record<string, unknown>, isExcellent: boolean): FacilityDoc {
  const areaValue = parseNumber(raw.ar as string | number | undefined);
  const areaMissing = areaValue === undefined;

  const region = extractRegionFromRaw(raw);
  const installYear = parseNumber(raw.instlYy);
  const lat = parseNumber(raw.latitude);
  const lng = parseNumber(raw.longitude);

  return stripUndefinedDeep({
    pfctSn: Number(raw.pfctSn),
    facilityName: parseText(raw.pfctNm) ?? '이름없음',
    sido: region.sido,
    sigungu: region.sigungu,
    address: region.address,
    normalizedAddress: normalizeAddress(region.address),
    lat,
    lng,
    installPlaceCode: String(raw.inslPlcSeCd ?? 'A003') as InstallPlaceCode,
    installYear,
    area: areaValue ?? 400,
    areaMissing,
    isExcellent,
    updatedAt: new Date().toISOString(),
  });
}

export function dedupeByCoordinate<T extends { lat?: number; lng?: number; pfctSn: number; address?: string }>(input: T[]): T[] {
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
      return a.pfctSn - b.pfctSn;
    })[0];
    selected.push(picked);
  }

  return selected;
}
