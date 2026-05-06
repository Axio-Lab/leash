import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * Proxy to `apps/api`'s `GET /v1/discover?capability=…`.
 *
 * `/v1/discover` is the unified, source-tagged search endpoint: each
 * row carries `source: 'leash' | 'pay-skills'` so the Favorites UI
 * can render approved Leash marketplace listings *and* providers
 * pulled from the Solana Foundation pay-skills registry in one list.
 *
 * `/v1/discover` is public, so no admin secret is forwarded — search
 * surfaces no PII beyond what the public catalogues already publish.
 */
export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const sourceParam = url.searchParams.get('source') ?? '';
  const env = getServerEnv();
  try {
    const upstreamUrl = new URL(`${env.leashApiUrl.replace(/\/+$/, '')}/v1/discover`);
    // Only narrow by capability once the user typed ≥2 chars — shorter
    // queries stay in "browse" mode (`/v1/discover` with no capability)
    // so Favorites isn't empty on first paint.
    if (q.length >= 2) upstreamUrl.searchParams.set('capability', q);
    if (sourceParam === 'leash' || sourceParam === 'pay-skills' || sourceParam === 'all') {
      upstreamUrl.searchParams.set('source', sourceParam);
    }
    upstreamUrl.searchParams.set('limit', '50');
    const upstream = await fetch(upstreamUrl);
    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        {
          items: [],
          discover_error: {
            upstream_status: upstream.status,
            upstream_url: upstreamUrl.toString(),
            detail: text.slice(0, 400),
          },
        },
        { status: 200 },
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          items: [],
          discover_error: {
            upstream_status: upstream.status,
            upstream_url: upstreamUrl.toString(),
            detail: 'upstream returned non-JSON',
          },
        },
        { status: 200 },
      );
    }
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json(
      {
        items: [],
        discover_error: {
          upstream_status: 0,
          detail: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 200 },
    );
  }
}
