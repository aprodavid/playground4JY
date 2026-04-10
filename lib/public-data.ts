import { getPublicDataEnv } from './env';

type ApiItem = Record<string, string | number | undefined | null>;

type ApiResponse = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      totalCount?: number | string;
      pageNo?: number | string;
      numOfRows?: number | string;
      pageIndex?: number | string;
      recordCountPerPage?: number | string;
      totalPageCnt?: number | string;
      items?: { item?: ApiItem[] | ApiItem } | ApiItem[] | ApiItem;
    };
  };
};

type AttemptResult = {
  keyMode: 'raw' | 'encoded';
  url: string;
  status: number;
  ok: boolean;
  errorMessage?: string;
  parseOk?: boolean;
  itemCount?: number;
};

export type PublicDataCallMeta = {
  endpoint: string;
  baseUrl: string;
  finalUrl: string;
  keyMode: 'raw' | 'encoded';
  status: number;
  parseOk: boolean;
  itemCount: number;
  pageInfo: {
    totalPageCnt: number | null;
    totalCount: number | null;
    pageIndex: number | null;
    recordCountPerPage: number | null;
    pageNo: number | null;
    numOfRows: number | null;
  };
  attempts: AttemptResult[];
};

export type PaginatedFetchResult = {
  items: ApiItem[];
  pagesFetched: number;
  totalPageCnt: number | null;
  metaByPage: PublicDataCallMeta[];
};

export type InstallPlacePageFetchResult = {
  items: ApiItem[];
  pagesFetched: number;
  metaByPage: PublicDataCallMeta[];
};

export class PublicDataError extends Error {
  constructor(
    message: string,
    public readonly detail: {
      type: 'status' | 'parse' | 'auth' | 'invalid-url' | 'empty-result' | 'network' | 'unknown';
      endpoint: string;
      status?: number;
      attempts?: AttemptResult[];
      url?: string;
      parseOk?: boolean;
    },
  ) {
    super(message);
    this.name = 'PublicDataError';
  }
}

function parseMaybeNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function normalizeItems(rawItems: ApiResponse['response'] extends { body?: infer B } ? B extends { items?: infer I } ? I : unknown : unknown): ApiItem[] {
  if (!rawItems) return [];
  if (Array.isArray(rawItems)) return rawItems;
  if (typeof rawItems === 'object' && rawItems !== null && 'item' in rawItems) {
    const withItem = rawItems as { item?: ApiItem[] | ApiItem };
    if (!withItem.item) return [];
    return Array.isArray(withItem.item) ? withItem.item : [withItem.item];
  }
  if (typeof rawItems === 'object') return [rawItems as ApiItem];
  return [];
}

function redactUrl(url: URL): string {
  const redacted = new URL(url.toString());
  if (redacted.searchParams.has('serviceKey')) redacted.searchParams.set('serviceKey', '***');
  return redacted.toString();
}

async function fetchDataWithMeta(endpointPath: string, params: Record<string, string | number>) {
  const { baseUrl, serviceKey } = getPublicDataEnv();

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedEndpoint = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  const keyModes: Array<{ mode: 'raw' | 'encoded'; key: string }> = [{ mode: 'raw', key: serviceKey }];
  const encodedKey = encodeURIComponent(serviceKey);
  if (encodedKey !== serviceKey) keyModes.push({ mode: 'encoded', key: encodedKey });

  const attempts: AttemptResult[] = [];
  let lastError: PublicDataError | null = null;

  for (const keyMode of keyModes) {
    let url: URL;
    try {
      url = new URL(`${normalizedBase}${normalizedEndpoint}`);
    } catch {
      throw new PublicDataError('Invalid public API URL', {
        type: 'invalid-url',
        endpoint: normalizedEndpoint,
      });
    }

    url.searchParams.set('serviceKey', keyMode.key);
    url.searchParams.set('_type', 'json');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

    const logUrl = redactUrl(url);

    try {
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        attempts.push({ keyMode: keyMode.mode, url: logUrl, status: res.status, ok: false, errorMessage: `HTTP ${res.status}` });
        lastError = new PublicDataError(`Public API status error: ${res.status}`, {
          type: res.status === 401 || res.status === 403 ? 'auth' : 'status',
          endpoint: normalizedEndpoint,
          status: res.status,
          attempts,
          url: logUrl,
        });
        continue;
      }

      let json: ApiResponse;
      try {
        json = (await res.json()) as ApiResponse;
      } catch {
        attempts.push({ keyMode: keyMode.mode, url: logUrl, status: res.status, ok: false, errorMessage: 'JSON parse failed', parseOk: false });
        lastError = new PublicDataError('Public API JSON parse failed', {
          type: 'parse',
          endpoint: normalizedEndpoint,
          status: res.status,
          attempts,
          url: logUrl,
          parseOk: false,
        });
        continue;
      }

      const body = json.response?.body;
      const items = normalizeItems(body?.items);
      const parseOk = Boolean(json.response && body);

      attempts.push({ keyMode: keyMode.mode, url: logUrl, status: res.status, ok: true, parseOk, itemCount: items.length });

      if (!parseOk) {
        lastError = new PublicDataError('Public API response schema parse failed', {
          type: 'parse',
          endpoint: normalizedEndpoint,
          status: res.status,
          attempts,
          url: logUrl,
          parseOk: false,
        });
        continue;
      }

      return {
        items,
        meta: {
          endpoint: normalizedEndpoint,
          baseUrl: normalizedBase,
          finalUrl: logUrl,
          keyMode: keyMode.mode,
          status: res.status,
          parseOk,
          itemCount: items.length,
          pageInfo: {
            totalPageCnt: parseMaybeNumber(body?.totalPageCnt),
            totalCount: parseMaybeNumber(body?.totalCount),
            pageIndex: parseMaybeNumber(body?.pageIndex),
            recordCountPerPage: parseMaybeNumber(body?.recordCountPerPage),
            pageNo: parseMaybeNumber(body?.pageNo),
            numOfRows: parseMaybeNumber(body?.numOfRows),
          },
          attempts,
        } satisfies PublicDataCallMeta,
      };
    } catch (error) {
      attempts.push({ keyMode: keyMode.mode, url: logUrl, status: 0, ok: false, errorMessage: error instanceof Error ? error.message : 'network error' });
      lastError = new PublicDataError('Public API network error', {
        type: 'network',
        endpoint: normalizedEndpoint,
        attempts,
        url: logUrl,
      });
    }
  }

  const finalError = lastError ?? new PublicDataError('Public API unknown failure', { type: 'unknown', endpoint: normalizedEndpoint, attempts });
  console.error('[public-data] request failed', finalError.detail);
  throw finalError;
}

async function fetchAllPages(
  endpointPath: string,
  baseParams: Record<string, string | number>,
  options?: { pageSize?: number; maxPages?: number },
): Promise<PaginatedFetchResult> {
  const pageSize = options?.pageSize ?? 500;
  const maxPages = options?.maxPages ?? 1000;

  const items: ApiItem[] = [];
  const metaByPage: PublicDataCallMeta[] = [];
  let pageIndex = 1;
  let totalPageCnt: number | null = null;

  while (pageIndex <= maxPages) {
    const params = {
      ...baseParams,
      pageIndex,
      recordCountPerPage: pageSize,
    };

    const page = await fetchDataWithMeta(endpointPath, params);
    metaByPage.push(page.meta);
    items.push(...page.items);

    totalPageCnt = page.meta.pageInfo.totalPageCnt;
    if (totalPageCnt !== null) {
      if (pageIndex >= totalPageCnt) break;
      pageIndex += 1;
      continue;
    }

    if (page.items.length < pageSize) break;
    pageIndex += 1;
  }

  return {
    items,
    pagesFetched: metaByPage.length,
    totalPageCnt,
    metaByPage,
  };
}

export async function fetchPfc3WithMeta(params: Record<string, string | number>) {
  return fetchDataWithMeta('/pfc3/getPfctInfo3', params);
}

export async function fetchPfc3(params: Record<string, string | number>) {
  const result = await fetchPfc3WithMeta(params);
  return result.items;
}

export async function fetchPfc3AllPages(params: Record<string, string | number>, options?: { pageSize?: number; maxPages?: number }) {
  return fetchAllPages('/pfc3/getPfctInfo3', params, options);
}

export const PFC3_INSTALL_PLACE_CODES = ['A003', 'A022', 'A033'] as const;

export async function fetchPfc3AcrossInstallPlaces(options?: {
  pageSize?: number;
  maxPages?: number;
  extraParams?: Record<string, string | number>;
}): Promise<InstallPlacePageFetchResult> {
  const items: ApiItem[] = [];
  const metaByPage: PublicDataCallMeta[] = [];

  for (const installPlaceCode of PFC3_INSTALL_PLACE_CODES) {
    const result = await fetchPfc3AllPages(
      {
        ...(options?.extraParams ?? {}),
        inslPlcSeCd: installPlaceCode,
      },
      { pageSize: options?.pageSize, maxPages: options?.maxPages },
    );
    items.push(...result.items);
    metaByPage.push(...result.metaByPage);
  }

  return { items, pagesFetched: metaByPage.length, metaByPage };
}

export async function fetchRide4(pfctSn: number) {
  const result = await fetchDataWithMeta('/ride4/getRide4', { pfctSn });
  return result.items;
}

export async function fetchExfc5(params: Record<string, string | number>) {
  const result = await fetchDataWithMeta('/exfc5/getExfc5', params);
  return result.items;
}

export async function fetchExfc5AllPages(params: Record<string, string | number>, options?: { pageSize?: number; maxPages?: number }) {
  return fetchAllPages('/exfc5/getExfc5', params, options);
}
