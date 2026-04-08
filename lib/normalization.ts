import { type FacilityDoc, type InstallPlaceCode } from '@/types/domain';

function parseNumber(input: unknown): number | undefined {
  if (typeof input === 'number') return input;
  if (typeof input === 'string') {
    const n = Number(input.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, ' ').trim();
}

function addressSpecificity(address: string): number {
  return address.split(' ').length;
}

export function toFacilityDoc(raw: Record<string, unknown>, isExcellent: boolean): FacilityDoc {
  const areaValue = parseNumber(raw.ar as string | number | undefined);
  const areaMissing = areaValue === undefined;

  return {
    pfctSn: Number(raw.pfctSn),
    facilityName: String(raw.pfctNm ?? '이름없음'),
    sido: String(raw.ctprvnNm ?? ''),
    sigungu: String(raw.signguNm ?? ''),
    address: String(raw.rdnmadr ?? raw.lnmadr ?? ''),
    normalizedAddress: normalizeAddress(String(raw.rdnmadr ?? raw.lnmadr ?? '')),
    lat: parseNumber(raw.latitude),
    lng: parseNumber(raw.longitude),
    installPlaceCode: String(raw.inslPlcSeCd ?? 'A003') as InstallPlaceCode,
    installYear: parseNumber(raw.instlYy),
    area: areaValue ?? 400,
    areaMissing,
    isExcellent,
    updatedAt: new Date().toISOString(),
  };
}

export function dedupeByCoordinate(input: FacilityDoc[]): FacilityDoc[] {
  const groups = new Map<string, FacilityDoc[]>();
  for (const f of input) {
    const key = f.lat && f.lng ? `${f.lat.toFixed(6)}:${f.lng.toFixed(6)}` : `no:${f.pfctSn}`;
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
