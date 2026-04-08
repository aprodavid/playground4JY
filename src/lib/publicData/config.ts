import 'server-only';

export const PUBLIC_DATA_ENDPOINTS = {
  pfc3: '/pfc3',
  ride4: '/ride4',
  exfc5: '/exfc5',
} as const;

export type PublicDataEndpoint = keyof typeof PUBLIC_DATA_ENDPOINTS;
