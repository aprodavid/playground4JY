export type InstallPlaceCode = 'A003' | 'A022' | 'A033';

export type CacheMetaDoc = {
  regionKey: string;
  sido?: string;
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'stopped';
  baselineReady?: boolean;
  currentStage?: string;
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPages?: number | null;
  pagesFetched?: number;
  rawFacilityCount?: number;
  filteredFacilityCount?: number;
  lastPageItemCount?: number;
  parsePathUsed?: string;
  lastError?: string | null;
  updatedAt?: string;
};
