import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `POST /api/uploads/image` — proxy to apps/api's admin-gated image
 * uploader. The browser POSTs `{ data_url }` (a base64 data URL) and
 * gets back `{ hash, url, size, mime }`. The returned `url` is the
 * public `/v1/uploads/<hash>` route on apps/api and can be used as an
 * `<img src>` directly.
 *
 * Why a BFF hop: only admin-secret holders can write blobs. End users
 * authenticate to this route with Privy; we forward to apps/api with
 * the platform admin secret on their behalf.
 */
export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as null | { data_url?: string };
  if (!body?.data_url) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const env = getServerEnv();
  try {
    const upstream = await fetch(`${env.leashApiUrl}/v1/platform/uploads/image`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.leashApiAdminSecret}`,
      },
      body: JSON.stringify({ data_url: body.data_url }),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: 'apps/api is offline; image not stored.' },
      { status: 503 },
    );
  }
}
