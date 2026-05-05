/**
 * BFF proxy for `/v1/external/connections` on apps/api. The admin
 * surface there is gated by `LEASH_API_ADMIN_SECRET`; this route
 * authenticates the browser via Privy and forwards the request with
 * the admin secret on behalf of the signed-in user (scoped to their
 * privy id, so they can only ever see their own connections).
 */

import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const env = getServerEnv();
  const url = new URL(`${env.leashApiUrl}/v1/external/connections`);
  url.searchParams.set('owner_privy_id', session.privyId);
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  // Always pin the owner to the signed-in user — the BFF NEVER lets the
  // browser claim an arbitrary privy id. Whatever was in the request
  // body is overwritten here.
  body.owner_privy_id = session.privyId;

  const env = getServerEnv();
  const res = await fetch(`${env.leashApiUrl}/v1/external/connections`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.leashApiAdminSecret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
