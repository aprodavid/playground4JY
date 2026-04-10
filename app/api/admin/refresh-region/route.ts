import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dedupeByCoordinate, toFacilityDoc } from '@/lib/normalization';
import { fetchExfc5, fetchPfc3, PublicDataError } from '@/lib/public-data';
import { isMissingEnvError } from '@/lib/env';
import { setCacheMeta, upsertFacilities } from '@/lib/firestore-repo';

const schema = z.object({ sido: z.string().min(1), sigungu: z.string().optional() });
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let regionKey = 'unknown';
  let failingEndpoint: string | null = null;
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });

    const { sido, sigungu } = parsed.data;
    regionKey = `${sido}:${sigungu ?? 'ALL'}`;
    const [pfc3, exfc5] = await Promise.all([
      fetchPfc3({ ctprvnNm: sido, ...(sigungu ? { signguNm: sigungu } : {}) }),
      fetchExfc5({ ctprvnNm: sido, ...(sigungu ? { signguNm: sigungu } : {}) }),
    ]);

    const excellentSet = new Set(exfc5.map((x) => Number(x.pfctSn)));
    const normalized = pfc3.map((row) => toFacilityDoc(row, excellentSet.has(Number(row.pfctSn))));
    const deduped = dedupeByCoordinate(normalized);

    await upsertFacilities(deduped);
    await setCacheMeta(regionKey, {
      regionKey,
      lastBuiltAt: new Date().toISOString(),
      facilitiesCount: deduped.length,
      excellentCount: deduped.filter((x) => x.isExcellent).length,
      lastBuildStatus: 'ok',
    });

    return NextResponse.json({ regionKey, facilitiesCount: deduped.length });
  } catch (error) {
    if (error instanceof PublicDataError) {
      failingEndpoint = error.detail.endpoint;
    }

    if (regionKey !== 'unknown') {
      await setCacheMeta(regionKey, {
        regionKey,
        lastBuiltAt: new Date().toISOString(),
        facilitiesCount: 0,
        excellentCount: 0,
        lastBuildStatus: 'error',
        lastError: error instanceof Error ? error.message : 'unknown error',
      });
    }
    if (isMissingEnvError(error)) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    if (error instanceof PublicDataError) {
      return NextResponse.json({
        message: 'refresh-region failed',
        errorType: error.detail.type,
        status: error.detail.status ?? null,
        endpoint: error.detail.endpoint,
        attempts: error.detail.attempts ?? [],
        detailMessage: error.message,
      }, { status: 502 });
    }
    return NextResponse.json({ message: 'refresh-region failed', errorType: 'unknown', endpoint: failingEndpoint }, { status: 500 });
  }
}
