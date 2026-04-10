import { z } from 'zod';
import { BASELINE_META_KEY, getAllFacilities, getCacheMeta, getRideCaches, setCacheMeta, upsertRideCache } from '@/lib/firestore-repo';
import { fetchRide4, PublicDataError } from '@/lib/public-data';
import { isMissingEnvError } from '@/lib/env';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/admin-json';
import { RIDE_WHITELIST } from '@/types/domain';
import { dedupeByCoordinate } from '@/lib/normalization';

const schema = z.object({ action: z.enum(['start', 'continue']).default('start'), batchSize: z.number().int().min(10).max(300).default(120) });
export const runtime = 'nodejs';

type RideTarget = { pfctSn: number; lat?: number; lng?: number; address?: string; isExcellent?: boolean };

async function buildRideCache(pfctSn: number) {
  try {
    const rides = await fetchRide4(pfctSn);
    const filtered = rides.filter((r) => RIDE_WHITELIST.includes(String(r.playkndCd) as never));
    const types = [...new Set(filtered.map((r) => String(r.playkndCd)))];
    await upsertRideCache({
      pfctSn,
      rawCount: rides.length,
      filteredCount: filtered.length,
      typeCount: types.length,
      types,
      updatedAt: new Date().toISOString(),
      status: filtered.length > 0 ? 'ok' : 'empty',
    });
    return { updated: 1, error: 0 };
  } catch (error) {
    await upsertRideCache({
      pfctSn,
      rawCount: 0,
      filteredCount: 0,
      typeCount: 0,
      types: [],
      updatedAt: new Date().toISOString(),
      status: 'error',
      lastError: error instanceof Error ? error.message : 'unknown error',
    });
    return { updated: 0, error: 1 };
  }
}

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await parseJsonBody(req));
    if (!parsed.success) return jsonOk({ message: 'invalid payload', errorType: 'validation', errors: parsed.error.flatten() }, 400);
    const { action, batchSize } = parsed.data;

    const baselineMeta = await getCacheMeta(BASELINE_META_KEY);
    if (!baselineMeta || baselineMeta.baselineStatus !== 'success') {
      return jsonOk({ message: '기준선 캐시가 없어 ride 캐시를 갱신할 수 없습니다. 먼저 기준선 캐시를 빌드하세요.', rideStatus: 'idle' }, 409);
    }

    const facilities = await getAllFacilities();
    const representativeTargets = dedupeByCoordinate(
      facilities.map((f) => ({ pfctSn: f.pfctSn, lat: f.lat, lng: f.lng, address: f.address, isExcellent: f.isExcellent } satisfies RideTarget)),
    )
      .sort((a, b) => Number(Boolean(b.isExcellent)) - Number(Boolean(a.isExcellent)));

    const existing = await getRideCaches(representativeTargets.map((x) => x.pfctSn));
    const existingSet = new Set(existing.map((x) => x.pfctSn));
    const missing = representativeTargets.filter((x) => !existingSet.has(x.pfctSn));

    const progress = action === 'start' || !baselineMeta.rideProgress
      ? { totalTargets: missing.length, processedTargets: 0, updatedTargets: 0, errorTargets: 0, skippedExistingTargets: representativeTargets.length - missing.length }
      : baselineMeta.rideProgress;

    const remaining = Math.max(0, progress.totalTargets - progress.processedTargets);
    const targets = missing.slice(progress.processedTargets, progress.processedTargets + Math.min(batchSize, remaining));

    const now = new Date().toISOString();
    await setCacheMeta(BASELINE_META_KEY, {
      rideStatus: targets.length > 0 ? 'running' : 'success',
      rideStartedAt: action === 'start' ? now : baselineMeta.rideStartedAt ?? now,
      rideUpdatedAt: now,
      rideLastError: null,
      rideProgress: progress,
    });

    let updatedBatch = 0;
    let errorBatch = 0;
    for (const target of targets) {
      const result = await buildRideCache(target.pfctSn);
      updatedBatch += result.updated;
      errorBatch += result.error;
    }

    const nextProgress = {
      ...progress,
      processedTargets: progress.processedTargets + targets.length,
      updatedTargets: progress.updatedTargets + updatedBatch,
      errorTargets: progress.errorTargets + errorBatch,
    };

    const done = nextProgress.processedTargets >= nextProgress.totalTargets;
    await setCacheMeta(BASELINE_META_KEY, {
      rideStatus: done ? 'success' : 'running',
      rideUpdatedAt: new Date().toISOString(),
      rideProgress: nextProgress,
      rideLastError: null,
    });

    return jsonOk({
      message: done ? 'ride 캐시 배치 갱신이 완료되었습니다.' : 'ride 캐시 배치 갱신을 진행했습니다.',
      rideStatus: done ? 'success' : 'running',
      done,
      batchProcessed: targets.length,
      updatedBatch,
      errorBatch,
      progress: nextProgress,
    });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return jsonError(error.message, { status: 500, errorType: 'missing-env' });
    }
    if (error instanceof PublicDataError) {
      await setCacheMeta(BASELINE_META_KEY, { rideStatus: 'error', rideUpdatedAt: new Date().toISOString(), rideLastError: error.message });
      return jsonError('refresh-rides failed', {
        status: 502,
        errorType: error.detail.type,
        detailMessage: error.message,
        endpoint: error.detail.endpoint,
        extra: { status: error.detail.status ?? null, attempts: error.detail.attempts ?? [] },
      });
    }
    await setCacheMeta(BASELINE_META_KEY, { rideStatus: 'error', rideUpdatedAt: new Date().toISOString(), rideLastError: error instanceof Error ? error.message : 'unknown error' });
    return jsonError('refresh-rides failed', { status: 500, errorType: 'unknown', detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
