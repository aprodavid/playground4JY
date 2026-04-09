import { NextResponse } from 'next/server';
import { KOREA_SIDO_LIST } from '@/types/domain';

export function GET() {
  return NextResponse.json({ sido: KOREA_SIDO_LIST });
}
