import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ mint: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { mint } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const env = getServerEnv();
  try {
    const upstream = await fetch(
      `${env.leashApiUrl}/v1/platform/agents/${encodeURIComponent(mint)}/identity/domains/verify`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.leashApiAdminSecret}`,
        },
        body: JSON.stringify(body),
      },
    );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: 'apps/api is offline; domain not verified.' },
      { status: 503 },
    );
  }
}
