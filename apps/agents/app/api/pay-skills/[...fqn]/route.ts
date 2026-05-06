import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * Proxy to `apps/api`'s `GET /v1/discover/pay-skills/<fqn>`.
 *
 * Used by the Favorites UI to render a chosen `pay-skills` provider's
 * paid endpoints inline once the user expands a row. The upstream
 * route is public, but we still gate on a Privy session here so the
 * Favorites surface stays consistent with the marketplace search
 * BFF — no anonymous traffic from the chat product origin.
 *
 * Two- or three-segment FQNs are supported via the `[...fqn]`
 * catch-all: `/api/pay-skills/agentmail/email` and
 * `/api/pay-skills/coinbase-cdp/coinbase-developer-platform/baseSepoliaWalletApi`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ fqn: string[] }> }) {
  const session = await requirePrivySession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { fqn: segs } = await params;
  if (!Array.isArray(segs) || segs.length < 2 || segs.length > 3) {
    return NextResponse.json(
      { error: 'invalid_fqn', message: 'expected 2- or 3-segment FQN' },
      { status: 400 },
    );
  }
  const env = getServerEnv();
  try {
    const url = `${env.leashApiUrl.replace(/\/+$/, '')}/v1/discover/pay-skills/${segs
      .map((s) => encodeURIComponent(s))
      .join('/')}`;
    const upstream = await fetch(url);
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', message: 'pay-skills upstream unreachable' },
      { status: 502 },
    );
  }
}
