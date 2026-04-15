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

export type BaselineMetaDoc = {
  regionKey: string;
  sido: string;
  status: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'stopped';
  baselineReady: boolean;
  baselineBuildMode?: 'normal' | 'force-rebuild';
  currentStage: string;
  currentInstallPlace: string | null;
  currentPage: number;
  totalPagesCurrentInstallPlace: number | null;
  totalPagesOverall: number | null;
  pagesFetched: number;
  rawFacilityCount: number;
  filteredFacilityCount: number;
  lastPageItemCount: number;
  parsePathUsed: string;
  installPlaceFilterMode?: 'api' | 'server';
  installPlaceApiReliable?: boolean;
  parserDebugVersion?: string;
  lastPageUniqueInstallPlaces?: string[];
  lastPageSampleSidos?: string[];
  lastPageFilterReasonCounts?: Record<string, number>;
  consecutiveZeroItemPages: number;
  consecutiveAllFilteredOutPages: number;
  stopRequested?: boolean;
  lastError: string | null;
  lastStartedAt?: string;
  lastSuccessfulBaselineAt?: string;
  updatedAt: string;
};

export type RideMetaDoc = {
  regionKey: string;
  status: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'stopped';
  stopRequested?: boolean;
  runRequestedAt?: string;
  updatedAt: string;
  lastSuccessfulAt?: string;
  lastError: string | null;
  progress: {
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
