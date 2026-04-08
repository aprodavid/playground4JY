import { NextResponse } from 'next/server';
import { getFacilityByPfctSn } from '@/lib/firestore-repo';

export async function GET(_: Request, { params }: { params: Promise<{ pfctSn: string }> }) {
  const { pfctSn } = await params;
  const data = await getFacilityByPfctSn(Number(pfctSn));
  if (!data.facility) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
}
