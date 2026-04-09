import { GET as statusHandler } from '@/app/api/debug/status/route';

export const runtime = 'nodejs';
export const GET = statusHandler;
