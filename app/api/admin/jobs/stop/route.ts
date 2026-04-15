import { z } from 'zod';
import { baselineMetaKey, RIDE_META_KEY, setCacheMeta } from '@/lib/firestore-repo';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/admin-json';

const schema = z.object({
  type: z.enum(['baseline', 'ride']),
  sido: z.string().min(1).optional(),
});

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return jsonError('invalid payload', { status: 400, detailMessage: JSON.stringify(parsed.error.flatten()) });
    }
    const now = new Date().toISOString();

    if (parsed.data.type === 'baseline') {
      if (!parsed.data.sido) return jsonError('sido is required for baseline stop', { status: 400 });
      await setCacheMeta(baselineMetaKey(parsed.data.sido), { stopRequested: true, updatedAt: now, status: 'stopped' });
    } else {
      await setCacheMeta(RIDE_META_KEY, { stopRequested: true, updatedAt: now, status: 'stopped' });
    }

    return jsonOk({ message: 'stop requested' });
  } catch (error) {
    return jsonError('stop job failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
