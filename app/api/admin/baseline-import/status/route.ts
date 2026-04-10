import { jsonError, jsonOk } from '@/lib/admin-json';
import { BASELINE_META_KEY, getCacheMeta, getUploadCounts } from '@/lib/firestore-repo';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const [meta, uploadCounts] = await Promise.all([getCacheMeta(BASELINE_META_KEY), getUploadCounts()]);
    return jsonOk({
      baselineStatus: meta?.baselineStatus ?? 'idle',
      baselineSource: meta?.baselineSource ?? 'none',
      currentStage: meta?.baselineCurrentStage ?? null,
      progress: meta?.baselineImportProgress ?? { total: 0, processed: 0, success: 0, failure: 0 },
      facilitiesCount: meta?.facilitiesCount ?? 0,
      excellentCount: meta?.excellentCount ?? 0,
      baselineLastError: meta?.baselineLastError ?? null,
      baselineUnmatchedReasonCount: meta?.baselineUnmatchedReasonCount ?? {},
      uploadCounts,
      done: meta?.done ?? false,
    });
  } catch (error) {
    return jsonError('baseline import status failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
