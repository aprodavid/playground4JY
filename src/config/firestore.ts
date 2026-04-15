export const COLLECTIONS = {
  facilities: 'facilities',
  rideCache: 'rideCache',
  sigunguIndex: 'sigunguIndex',
  cacheMeta: 'cacheMeta',
} as const;

export const BASELINE_META_PREFIX = 'baseline:';
export const RIDE_META_KEY = 'ride:global';

export function baselineMetaKey(sido: string) {
  return `${BASELINE_META_PREFIX}${sido}`;
}
