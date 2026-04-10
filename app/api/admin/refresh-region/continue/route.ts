import { z } from 'zod';
import { isMissingEnvError } from '@/lib/env';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/admin-json';
import { buildRegionKey, continueRefreshRegionJob, getRefreshRegionJob, mapJobError } from '@/lib/refresh-region-job';

const schema = z.object({ sido: z.string().min(1), sigungu: z.string().optional() });

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return jsonOk({ message: 'invalid payload', errorType: 'validation', errors: parsed.error.flatten() }, 400);
    }

    const regionKey = buildRegionKey(parsed.data.sido, parsed.data.sigungu);
    const current = await getRefreshRegionJob(regionKey);
    if (!current) {
      return jsonError('refresh-region job not found', { status: 404, errorType: 'not-found', extra: { regionKey } });
    }

    const next = await continueRefreshRegionJob(current);
    return jsonOk({
      message: next.done ? 'refresh-region job completed' : 'refresh-region job continued',
      regionKey,
      jobId: next.jobId,
      status: next.status,
      currentStage: next.currentStage,
      currentInstallPlace: next.currentInstallPlace,
      currentPage: next.currentPage,
      totalPages: next.totalPages ?? null,
      pagesFetched: next.pagesFetched,
      rawFacilityCount: next.rawFacilityCount,
      filteredFacilityCount: next.filteredFacilityCount,
      successCount: next.successCount,
      errorCount: next.errorCount,
      done: next.done,
      lastError: next.lastError ?? null,
      selectedRegion: next.selectedRegion,
      startedAt: next.startedAt,
      updatedAt: next.updatedAt,
      buildDurationMs: next.buildDurationMs ?? null,
      facilitiesCount: next.facilitiesCount,
      excellentCount: next.excellentCount,
    });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return jsonError(error.message, { status: 500, errorType: 'missing-env' });
    }
    const mapped = mapJobError(error);
    return jsonError(mapped.message, {
      status: mapped.errorType === 'status' || mapped.errorType === 'parse' || mapped.errorType === 'auth' ? 502 : 500,
      errorType: mapped.errorType,
      detailMessage: mapped.detailMessage,
      endpoint: mapped.endpoint,
    });
  }
}
