export type InstallPlaceCode = 'A003' | 'A022' | 'A033';

export type CacheMetaDoc = {
  regionKey: string;
  sido?: string;
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'stopped';
  baselineReady?: boolean;
  currentStage?: string;
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPagesCurrentInstallPlace?: number | null;
  totalPagesOverall?: number | null;
  pagesFetched?: number;
  rawFacilityCount?: number;
  filteredFacilityCount?: number;
  lastPageItemCount?: number;
  parsePathUsed?: string;
  parserDebugVersion?: string;
  installPlaceFilterMode?: 'api' | 'server';
  installPlaceApiReliable?: boolean;
  lastPageUniqueInstallPlaces?: string[];
  lastPageSampleSidos?: string[];
  lastPageFilterReasonCounts?: Record<string, number>;
  consecutiveZeroItemPages?: number;
  consecutiveAllFilteredOutPages?: number;
  lastError?: string | null;
  updatedAt?: string;
};
