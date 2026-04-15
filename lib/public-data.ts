import { EXFC_URL, PFCT_URL, RIDE_URL } from '@/src/config/publicData';
import { getPublicDataEnv } from './env';

type ApiItem = Record<string, string | number | undefined | null>;

type Attempt = { keyMode: 'raw' | 'encoded'; status: number; url: string };

export type PublicDataCallMeta = {
  endpoint: string;
  finalUrl: string;
  keyMode: 'raw' | 'encoded';
  status: number;
  itemCount: number;
  attempts: Attempt[];
  pageInfo: { totalPageCnt: number | null };
};

function normalizeItems(raw: unknown): ApiItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ApiItem[];
  if (typeof raw === 'object' && raw !== null && 'item' in (raw as Record<string, unknown>)) {
    const item = (raw as { item?: ApiItem | ApiItem[] }).item;
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
  }
  if (typeof raw === 'object') return [raw as ApiItem];
  return [];
}

async function fetchWithKeyFallback(fullUrl: string, params: Record<string, string | number>) {
  const { serviceKey } = getPublicDataEnv();
  const attempts: Attempt[] = [];
  const keys = [serviceKey, encodeURIComponent(serviceKey)].filter((v, i, arr) => arr.indexOf(v) === i);

  for (const key of keys) {
    const url = new URL(fullUrl);
    url.searchParams.set('serviceKey', key);
    url.searchParams.set('_type', 'json');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString(), { cache: 'no-store' });
    attempts.push({ keyMode: key === serviceKey ? 'raw' : 'encoded', status: res.status, url: url.toString().replace(key, '***') });
    if (!res.ok) continue;
    const json = await res.json() as { response?: { body?: { items?: unknown; totalPageCnt?: string | number } } };
    const items = normalizeItems(json.response?.body?.items);
    return {
      items,
      meta: {
        endpoint: fullUrl,
        finalUrl: attempts[attempts.length - 1].url,
        keyMode: attempts[attempts.length - 1].keyMode,
        status: res.status,
        itemCount: items.length,
        attempts,
        pageInfo: { totalPageCnt: Number(json.response?.body?.totalPageCnt ?? 0) || null },
      } satisfies PublicDataCallMeta,
    };
  }
  throw new Error(`public API call failed: ${fullUrl}`);
}

async function fetchAllPages(fullUrl: string, params: Record<string, string | number>, options?: { pageSize?: number; maxPages?: number }) {
  const pageSize = options?.pageSize ?? 200;
  const maxPages = options?.maxPages ?? 1000;
  const items: ApiItem[] = [];
  const metaByPage: PublicDataCallMeta[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchWithKeyFallback(fullUrl, { ...params, pageIndex: page, pageNo: page, recordCountPerPage: pageSize, numOfRows: pageSize });
    items.push(...result.items);
    metaByPage.push(result.meta);
    if ((result.meta.pageInfo.totalPageCnt && page >= result.meta.pageInfo.totalPageCnt) || result.items.length < pageSize) break;
  }

  return { items, pagesFetched: metaByPage.length, totalPageCnt: metaByPage.at(-1)?.pageInfo.totalPageCnt ?? null, metaByPage };
}

export async function fetchPfc3WithMeta(params: Record<string, string | number>) { return fetchWithKeyFallback(PFCT_URL, params); }
export async function fetchPfc3(params: Record<string, string | number>) { return (await fetchPfc3WithMeta(params)).items; }
export async function fetchPfc3AllPages(params: Record<string, string | number>, options?: { pageSize?: number; maxPages?: number }) { return fetchAllPages(PFCT_URL, params, options); }
export async function fetchPfc3AcrossInstallPlaces() {
  const all: ApiItem[] = [];
  const metaByPage: PublicDataCallMeta[] = [];
  for (const code of ['A003', 'A022', 'A033']) {
    const r = await fetchPfc3AllPages({ inslPlcSeCd: code });
    all.push(...r.items);
    metaByPage.push(...r.metaByPage);
  }
  return { items: all, pagesFetched: metaByPage.length, metaByPage };
}

export async function fetchRide4(pfctSn: string) { return (await fetchWithKeyFallback(RIDE_URL, { pfctSn })).items; }
export async function fetchExfc5WithMeta(params: Record<string, string | number>) { return fetchWithKeyFallback(EXFC_URL, params); }
export async function fetchExfc5(params: Record<string, string | number>) { return (await fetchExfc5WithMeta(params)).items; }
export async function fetchExfc5AllPages(params: Record<string, string | number>, options?: { pageSize?: number; maxPages?: number }) { return fetchAllPages(EXFC_URL, params, options); }
