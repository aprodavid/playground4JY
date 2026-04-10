import { NextResponse } from 'next/server';

export function jsonOk(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export function jsonError(message: string, options?: {
  status?: number;
  errorType?: string;
  detailMessage?: string;
  endpoint?: string | null;
  extra?: Record<string, unknown>;
}) {
  return jsonOk({
    message,
    errorType: options?.errorType ?? 'unknown',
    detailMessage: options?.detailMessage ?? message,
    endpoint: options?.endpoint ?? null,
    ...(options?.extra ?? {}),
  }, options?.status ?? 500);
}

export async function parseJsonBody<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}
