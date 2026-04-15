import { NextResponse } from 'next/server';
import { KOREA_SIDO_LIST } from '@/src/config/regions';

export function GET() {
  return NextResponse.json({ sido: KOREA_SIDO_LIST });
}
