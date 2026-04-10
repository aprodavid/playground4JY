import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dedupeByCoordinate, matchesSelectedRegion, stripUndefinedDeep, toFacilityDoc } from '@/lib/normalization';
import { fetchExfc5AllPages, fetchPfc3AcrossInstallPlaces, PublicDataError } from '@/lib/public-data';
import { isMissingEnvError } from '@/lib/env';
import { setCacheMeta, upsertFacilities } from '@/lib/firestore-repo';

const schema = z.object({ sido: z.string().min(1), sigungu: z.string().optional() });
export const runtime = 'nodejs';

type FirestoreWriteErrorDetail = {
  errorType: 'firestore-write';
  message: string;
  failingField: string | null;
};

function getFirestoreWriteErrorDetail(error: unknown): FirestoreWriteErrorDetail | null {
  if (!(error instanceof Error)) return null;
  const message = error.message ?? 'Firestore write failed';
  const hasFirestoreSignal = message.includes('Firestore') || message.includes('undefined') || message.includes('Cannot use "undefined"');
  if (!hasFirestoreSignal) return null;

  const failingFieldMatch = message.match(/field\s+"([^"]+)"/i);
  const failingField = failingFieldMatch?.[1] ?? null;
  const normalizedMessage = failingField
    ? `Firestore write failed: undefined field ${failingField}`
    : `Firestore write failed: ${message}`;

  return {
    errorType: 'firestore-write',
    message: normalizedMessage,
    failingField,
  };
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  let regionKey = 'unknown';
  let failingEndpoint: string | null = null;
  let pagesFetched = 0;
  let rawFacilityCount = 0;
  let filteredFacilityCount = 0;

  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });

    const { sido, sigungu } = parsed.data;
    regionKey = `${sido}:${sigungu ?? 'ALL'}`;

    const [pfc3Result, exfc5Result] = await Promise.all([
      fetchPfc3AcrossInstallPlaces({ pageSize: 500 }),
      fetchExfc5AllPages({ ctprvnNm: sido, ...(sigungu ? { signguNm: sigungu } : {}) }, { pageSize: 500 }),
    ]);

    pagesFetched = pfc3Result.pagesFetched + exfc5Result.pagesFetched;
    rawFacilityCount = pfc3Result.items.length;

    const regionFilteredRows = pfc3Result.items.filter((row) => matchesSelectedRegion(row, sido, sigungu));
    filteredFacilityCount = regionFilteredRows.length;

    const excellentSet = new Set(
      exfc5Result.items
        .filter((row) => matchesSelectedRegion(row, sido, sigungu))
        .map((x) => Number(x.pfctSn)),
    );

    const normalized = regionFilteredRows.map((row) => toFacilityDoc(row, excellentSet.has(Number(row.pfctSn))));
    const deduped = dedupeByCoordinate(normalized).map((facility) => stripUndefinedDeep(facility));

    await upsertFacilities(deduped);

    const buildDurationMs = Date.now() - startedAt;
    await setCacheMeta(regionKey, stripUndefinedDeep({
      regionKey,
      lastBuiltAt: new Date().toISOString(),
      facilitiesCount: deduped.length,
      excellentCount: deduped.filter((x) => x.isExcellent).length,
      pagesFetched,
      rawFacilityCount,
      filteredFacilityCount,
      selectedRegion: stripUndefinedDeep({ sido, ...(sigungu ? { sigungu } : {}) }),
      buildDurationMs,
      lastBuildStatus: 'ok',
    }));

    return NextResponse.json({
      regionKey,
      facilitiesCount: deduped.length,
      pagesFetched,
      rawFacilityCount,
      filteredFacilityCount,
      buildDurationMs,
      message: `지역 캐시 ${deduped.length}건 빌드 완료`,
    });
  } catch (error) {
    if (error instanceof PublicDataError) {
      failingEndpoint = error.detail.endpoint;
    }

    const firestoreWriteError = getFirestoreWriteErrorDetail(error);

    if (regionKey !== 'unknown') {
      await setCacheMeta(regionKey, stripUndefinedDeep({
        regionKey,
        lastBuiltAt: new Date().toISOString(),
        facilitiesCount: 0,
        excellentCount: 0,
        pagesFetched,
        rawFacilityCount,
        filteredFacilityCount,
        buildDurationMs: Date.now() - startedAt,
        lastBuildStatus: 'error',
        lastError: firestoreWriteError?.message ?? (error instanceof Error ? error.message : 'unknown error'),
      }));
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
    if (firestoreWriteError) {
      return NextResponse.json({
        message: 'refresh-region failed',
        errorType: firestoreWriteError.errorType,
        detailMessage: firestoreWriteError.message,
        failingField: firestoreWriteError.failingField,
        endpoint: failingEndpoint,
      }, { status: 500 });
    }
    return NextResponse.json({
      message: 'refresh-region failed',
      errorType: 'unknown',
      endpoint: failingEndpoint,
      detailMessage: error instanceof Error ? error.message : 'unknown error',
    }, { status: 500 });
  }
}
