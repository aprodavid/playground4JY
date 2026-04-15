import { z } from 'zod';
import { baselineMetaKey, RIDE_META_KEY, setCacheMeta } from '@/lib/firestore-repo';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/admin-json';

const schema = z.object({
  type: z.enum(['baseline', 'ride']),
  sido: z.string().min(1).optional(),
  mode: z.enum(['normal', 'force-rebuild']).optional(),
});

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return jsonError('invalid payload', { status: 400, detailMessage: JSON.stringify(parsed.error.flatten()) });
    }

    const { type } = parsed.data;
    const mode = parsed.data.mode ?? 'normal';
    const now = new Date().toISOString();

    if (type === 'baseline') {
      const sido = parsed.data.sido;
      if (!sido) return jsonError('sido is required for baseline', { status: 400 });

      const key = baselineMetaKey(sido);
      await setCacheMeta(key, {
        regionKey: key,
        sido,
        status: 'queued',
        baselineReady: false,
        baselineBuildMode: mode,
        stopRequested: false,
        currentStage: 'queued',
        currentInstallPlace: null,
        currentPage: 1,
        totalPagesCurrentInstallPlace: null,
        totalPagesOverall: null,
        pagesFetched: 0,
        rawFacilityCount: 0,
        filteredFacilityCount: 0,
        lastPageItemCount: 0,
        parsePathUsed: '',
        parserDebugVersion: 'baseline-filter-v2',
        installPlaceFilterMode: 'api',
        installPlaceApiReliable: true,
        lastPageUniqueInstallPlaces: [],
        lastPageSampleSidos: [],
        lastPageFilterReasonCounts: {},
        consecutiveZeroItemPages: 0,
        consecutiveAllFilteredOutPages: 0,
        lastError: null,
        lastStartedAt: now,
        runRequestedAt: now,
        updatedAt: now,
      });

      return jsonOk({ message: `${sido} baseline queued` }, 201);
    }

    await setCacheMeta(RIDE_META_KEY, {
      regionKey: RIDE_META_KEY,
      status: 'queued',
      stopRequested: false,
      runRequestedAt: now,
      lastError: null,
      updatedAt: now,
    });
    return jsonOk({ message: 'ride cache update queued' }, 201);
  } catch (error) {
    return jsonError('start job failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
