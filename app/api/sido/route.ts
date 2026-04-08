import { NextResponse } from 'next/server';
import { db } from '@/lib/firestore';

export async function GET() {
  const snap = await db.collection('facilities').select('sido').get();
  const sido = [...new Set(snap.docs.map((d) => String(d.get('sido') ?? '')).filter(Boolean))].sort();
  return NextResponse.json({ sido });
}
