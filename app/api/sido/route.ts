import { NextResponse } from 'next/server';
import { isMissingEnvError } from '@/lib/env';
import { getFirestoreAdmin } from '@/lib/firestore';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const db = getFirestoreAdmin();
    const snap = await db.collection('facilities').select('sido').get();
    const sido = [...new Set(snap.docs.map((d) => String(d.get('sido') ?? '')).filter(Boolean))].sort();
    return NextResponse.json({ sido });
  } catch (error) {
    if (isMissingEnvError(error)) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    return NextResponse.json({ message: 'sido lookup failed' }, { status: 500 });
  }
}
