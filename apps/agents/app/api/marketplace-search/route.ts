import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * Proxy to `apps/api`'s `GET /v1/marketplace/listings?q=…`. In Phase 1 the
 * marketplace itself isn't wired up yet so this returns an empty list,
 * but the route exists so the helper LLM tool calls never blow up. In
 * Phase 2 we lift the body straight from `apps/api`.
 */
export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const env = getServerEnv();
  try {
    const upstream = await fetch(
      `${env.leashApiUrl}/v1/marketplace/listings?q=${encodeURIComponent(q)}`,
      { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
    );
    if (upstream.status === 404) {
      return NextResponse.json({ items: [] });
    }
    if (!upstream.ok) {
      return NextResponse.json({ items: [] });
    }
    return NextResponse.json(await upstream.json());
  } catch {
    return NextResponse.json({ items: [] });
  }
}
