import { NextResponse, type NextRequest } from 'next/server';

import { fetchMcpManifest } from '@/lib/mcp-manifest';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `POST /api/manifest` — fetch & validate a `/.well-known/leash-mcp.json`
 * manifest the user pasted into the helper. Done server-side so we
 * bypass browser CORS restrictions and can size-limit the response.
 */
export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url || typeof body.url !== 'string') {
    return NextResponse.json(
      { error: 'invalid_request', message: 'url required' },
      { status: 400 },
    );
  }
  try {
    const manifest = await fetchMcpManifest(body.url);
    return NextResponse.json({ manifest });
  } catch (err) {
    return NextResponse.json(
      { error: 'manifest_invalid', message: (err as Error).message },
      { status: 422 },
    );
  }
}
