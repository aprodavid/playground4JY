import { type FacilityDoc, type InstallPlaceCode } from '@/types/domain';

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

const SIDO_SUFFIXES = ['특별시', '광역시', '특별자치시', '특별자치도', '자치도', '도', '시'];

function firstAddressToken(address: string): string | undefined {
  const first = parseText(address)?.split(' ')[0];
  return parseText(first);
}

function looksLikeSido(text?: string): boolean {
  if (!text) return false;
  return SIDO_SUFFIXES.some((suffix) => text.endsWith(suffix));
}

export function extractRegionFromRaw(raw: Record<string, unknown>) {
  const address = parseText(raw.rdnmadr) ?? parseText(raw.lnmadr) ?? parseText(raw.addr) ?? '';

  const sido =
    parseText(raw.ctprvnNm) ??
    parseText(raw.rgnNm) ??
    parseText(raw.region) ??
    (looksLikeSido(firstAddressToken(address)) ? firstAddressToken(address) : undefined) ??
    '';

  const sigungu =
    parseText(raw.signguNm) ??
    parseText(raw.sigunguNm) ??
    parseText(raw.sggNm) ??
    parseText(raw.district) ??
    parseText(raw.county) ??
    parseText(address.split(' ').slice(1, 2)[0]) ??
    '';

  return {
    sido,
    sigungu,
    address,
  };
}

export function matchesSelectedRegion(raw: Record<string, unknown>, sido: string, sigungu?: string): boolean {
  const region = extractRegionFromRaw(raw);
  if (region.sido !== sido) return false;
  if (sigungu && region.sigungu !== sigungu) return false;
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

export function dedupeByCoordinate(input: FacilityDoc[]): FacilityDoc[] {
  const groups = new Map<string, FacilityDoc[]>();
  for (const f of input) {
    const key = f.lat !== undefined && f.lng !== undefined ? `${f.lat.toFixed(6)}:${f.lng.toFixed(6)}` : `no:${f.pfctSn}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const selected: FacilityDoc[] = [];
  for (const candidates of groups.values()) {
    const picked = candidates.sort((a, b) => {
      const specificityDiff = addressSpecificity(b.address) - addressSpecificity(a.address);
      if (specificityDiff !== 0) return specificityDiff;
      return a.pfctSn - b.pfctSn;
    })[0];
    selected.push(picked);
  }

  return selected;
}
