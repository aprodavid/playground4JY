import type { InstallPlaceCode } from '@/src/config/installPlaces';

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

export type RawFacilityApiRow = Record<string, string | number | null | undefined>;
export type RawRideApiRow = Record<string, string | number | null | undefined>;

export type NormalizedFacility = {
  pfctSn: string;
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
  contentHash?: string;
  updatedAt: string;
};

export type FacilityDoc = NormalizedFacility;

export type RideCacheDoc = {
  pfctSn: string;
  rawCount: number;
  filteredCount: number;
  typeCount: number;
  types: string[];
  updatedAt: string;
  status: 'ok' | 'error' | 'empty';
  lastError?: string;
};

export type SigunguIndexDoc = {
  sido: string;
  sigungu: string[];
  updatedAt: string;
};

export type CacheMetaDoc = {
  regionKey: string;
  lastBuiltAt: string;
  facilitiesCount: number;
  excellentCount: number;
  status?: 'idle' | 'running' | 'success' | 'error' | 'stopped';
  done?: boolean;
  updatedAt?: string;
  lastError?: string | null;
  baselineStatus?: 'idle' | 'running' | 'success' | 'error' | 'stopped';
  baselineReady?: boolean;
  baselineVersion?: string;
  lastSuccessfulBaselineAt?: string;
  baselinePagesFetched?: number;
  baselineRawFacilityCount?: number;
  baselineFilteredFacilityCount?: number;
  baselineStartedAt?: string;
  baselineUpdatedAt?: string;
  baselineLastError?: string | null;
  baselineCurrentStage?: string;
  baselineCurrentInstallPlace?: string | null;
  baselineCurrentPage?: number;
  baselineTotalPages?: number | null;
  baselineBuildMode?: 'normal' | 'force-rebuild';
  rideStatus?: 'idle' | 'running' | 'success' | 'error' | 'stopped';
  rideStartedAt?: string;
  rideUpdatedAt?: string;
  rideLastError?: string | null;
  rideProgress?: {
    totalTargets: number;
    processedTargets: number;
    updatedTargets: number;
    errorTargets: number;
    skippedExistingTargets: number;
  };
};

export type SearchResult = {
  pfctSn: string;
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
  recommendationReasons: string[];
  warnings: string[];
  recommended: boolean;
};

export type JobType = 'baseline' | 'ride';
export type JobStatus = 'queued' | 'running' | 'success' | 'error' | 'stopped';

export type JobDoc = {
  jobId: string;
  type: JobType;
  status: JobStatus;
  currentStage?: string | null;
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPages?: number | null;
  pagesFetched?: number;
  rawFacilityCount?: number;
  filteredFacilityCount?: number;
  successCount?: number;
  errorCount?: number;
  startedAt?: string;
  updatedAt?: string;
  stopRequested?: boolean;
  lastError?: string | null;
  resultSummary?: Record<string, unknown> | null;
  cursor?: Record<string, unknown>;
};
