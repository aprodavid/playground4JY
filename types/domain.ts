export type InstallPlaceCode = 'A003' | 'A022' | 'A033';

export const INSTALL_PLACE_LABELS: Record<InstallPlaceCode, string> = {
  A003: '도시공원',
  A022: '박물관',
  A033: '공공도서관',
};

export const RIDE_WHITELIST = [
  'D001','D002','D003','D004','D005','D006','D007','D008','D009',
  'D020','D021','D022','D080','D050','D052',
] as const;

export const KOREA_SIDO_LIST = [
  '서울특별시',
  '부산광역시',
  '대구광역시',
  '인천광역시',
  '광주광역시',
  '대전광역시',
  '울산광역시',
  '세종특별자치시',
  '경기도',
  '강원특별자치도',
  '충청북도',
  '충청남도',
  '전북특별자치도',
  '전라남도',
  '경상북도',
  '경상남도',
  '제주특별자치도',
] as const;

export type WeightConfig = {
  recent3yBonus: number;
  recent5yBonus: number;
  area300: number;
  area600: number;
  area1000: number;
  type3: number;
  type4: number;
  type6: number;
  ride5: number;
  ride8: number;
  excellentBonus: number;
};

export const DEFAULT_WEIGHTS: WeightConfig = {
  recent3yBonus: 12,
  recent5yBonus: 6,
  area300: 3,
  area600: 6,
  area1000: 10,
  type3: 4,
  type4: 8,
  type6: 14,
  ride5: 3,
  ride8: 8,
  excellentBonus: 9,
};

export type FacilityDoc = {
  pfctSn: number;
  facilityName: string;
  sido: string;
  sigungu: string;
  address: string;
  normalizedAddress: string;
  lat?: number;
  lng?: number;
  installPlaceCode: InstallPlaceCode;
  installYear?: number;
  area: number;
  areaMissing: boolean;
  isExcellent: boolean;
  updatedAt: string;
};

export type RideCacheDoc = {
  pfctSn: number;
  rawCount: number;
  filteredCount: number;
  typeCount: number;
  types: string[];
  updatedAt: string;
  status: 'ok' | 'error' | 'empty';
  lastError?: string;
};

export type SearchResult = {
  pfctSn: number;
  facilityName: string;
  sido: string;
  sigungu: string;
  address: string;
  installPlaceCode: InstallPlaceCode;
  installYear?: number;
  area: number;
  areaMissing: boolean;
  isExcellent: boolean;
  rideTypeCount: number;
  rideCount: number;
  score: number;
  scoreBreakdown: string[];
  reasons: string[];
  warnings: string[];
  recommended: boolean;
};

export type CacheMetaDoc = {
  regionKey: string;
  lastBuiltAt: string;
  startedAt?: string;
  updatedAt?: string;
  facilitiesCount: number;
  excellentCount: number;
  pagesFetched?: number;
  rawFacilityCount?: number;
  filteredFacilityCount?: number;
  successCount?: number;
  errorCount?: number;
  currentStage?: string;
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPages?: number | null;
  selectedRegion?: { sido: string; sigungu?: string };
  buildDurationMs?: number;
  lastBuildStatus: 'ok' | 'error';
  status?: 'idle' | 'running' | 'success' | 'error';
  done?: boolean;
  lastError?: string | null;
};
