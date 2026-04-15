import { NextResponse } from 'next/server';
import { isMissingEnvError } from '@/lib/env';
import { getFacilityByPfctSn } from '@/lib/firestore-repo';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ pfctSn: string }> }) {
  try {
    const { pfctSn } = await params;
    const data = await getFacilityByPfctSn(pfctSn);
    if (!data.facility) return NextResponse.json({ message: 'Not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    if (isMissingEnvError(error)) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    return NextResponse.json({ message: 'facility lookup failed' }, { status: 500 });
  }
}
