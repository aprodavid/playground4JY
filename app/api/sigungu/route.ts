import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firestore';

export async function GET(req: NextRequest) {
  const sido = req.nextUrl.searchParams.get('sido');
  if (!sido) return NextResponse.json({ message: 'sido is required' }, { status: 400 });

  const snap = await db.collection('facilities').where('sido', '==', sido).select('sigungu').get();
  const sigungu = [...new Set(snap.docs.map((d) => String(d.get('sigungu') ?? '')).filter(Boolean))].sort();
  return NextResponse.json({ sigungu });
}
