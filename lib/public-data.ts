import { getPublicDataEnv } from './env';

type ApiItem = Record<string, string | number | undefined>;

type ApiResponse = {
  response?: {
    body?: {
      items?: { item?: ApiItem[] | ApiItem };
    };
  };
};

async function fetchData(endpoint: string, params: Record<string, string | number>) {
  const { baseUrl, serviceKey } = getPublicDataEnv();
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(`${normalizedBase}${normalizedEndpoint}`);
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('_type', 'json');

  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Public API failed: ${res.status}`);
  const json = (await res.json()) as ApiResponse;
  const items = json.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

export async function fetchPfc3(params: Record<string, string | number>) {
  return fetchData('/pfc3', params);
}

export async function fetchRide4(pfctSn: number) {
  return fetchData('/ride4', { pfctSn });
}

export async function fetchExfc5(params: Record<string, string | number>) {
  return fetchData('/exfc5', params);
}
