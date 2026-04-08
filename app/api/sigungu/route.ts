import { NextRequest, NextResponse } from 'next/server';
import { isMissingEnvError } from '@/lib/env';
import { getFirestoreAdmin } from '@/lib/firestore';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const sido = req.nextUrl.searchParams.get('sido');
    if (!sido) return NextResponse.json({ message: 'sido is required' }, { status: 400 });

    const db = getFirestoreAdmin();
    const snap = await db.collection('facilities').where('sido', '==', sido).select('sigungu').get();
    const sigungu = [...new Set(snap.docs.map((d) => String(d.get('sigungu') ?? '')).filter(Boolean))].sort();
    return NextResponse.json({ sigungu });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    return NextResponse.json({ message: 'sigungu lookup failed' }, { status: 500 });
  }
}
