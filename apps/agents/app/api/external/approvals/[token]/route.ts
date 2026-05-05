import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';

/**
 * `GET /api/external/approvals/{token}` — read-only proxy for the
 * matching public endpoint on apps/api. The `/approve/{token}` landing
 * page hits this from the browser before the user has a Privy session
 * (deep-link from Telegram), so the BFF intentionally does NOT require
 * authentication. The token is itself a one-time secret that gates
 * access — same shape as any pre-signed URL.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const env = getServerEnv();
  const res = await fetch(`${env.leashApiUrl}/v1/external/approvals/${encodeURIComponent(token)}`);
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
