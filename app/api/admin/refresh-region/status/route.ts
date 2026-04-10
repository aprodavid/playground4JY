import { NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/admin-json';
import { buildRegionKey, getRefreshRegionJob } from '@/lib/refresh-region-job';

const querySchema = z.object({ sido: z.string().min(1), sigungu: z.string().optional() });

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      sido: req.nextUrl.searchParams.get('sido') ?? '',
      sigungu: req.nextUrl.searchParams.get('sigungu') ?? undefined,
    });

    if (!parsed.success) {
      return jsonOk({ message: 'invalid query', errorType: 'validation', errors: parsed.error.flatten() }, 400);
    }

    const regionKey = buildRegionKey(parsed.data.sido, parsed.data.sigungu);
    const job = await getRefreshRegionJob(regionKey);

    if (!job) {
      return jsonError('refresh-region status not found', { status: 404, errorType: 'not-found', extra: { regionKey } });
    }

    return jsonOk({
      regionKey,
      jobId: job.jobId,
      status: job.status,
      currentStage: job.currentStage,
      currentInstallPlace: job.currentInstallPlace,
      currentPage: job.currentPage,
      totalPages: job.totalPages ?? null,
      pagesFetched: job.pagesFetched,
      rawFacilityCount: job.rawFacilityCount,
      filteredFacilityCount: job.filteredFacilityCount,
      successCount: job.successCount,
      errorCount: job.errorCount,
      done: job.done,
      lastError: job.lastError ?? null,
      selectedRegion: job.selectedRegion,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      buildDurationMs: job.buildDurationMs ?? null,
      facilitiesCount: job.facilitiesCount,
      excellentCount: job.excellentCount,
    });
  } catch (error) {
    return jsonError('refresh-region status failed', {
      status: 500,
      errorType: 'unknown',
      detailMessage: error instanceof Error ? error.message : 'unknown error',
    });
  }
}
