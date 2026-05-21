import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const env = getServerEnv();
  const upstreamUrl = new URL(`${env.leashApiUrl}/v1/platform/automations`);
  upstreamUrl.searchParams.set('owner_privy_id', session.privyId);
  const limit = req.nextUrl.searchParams.get('limit');
  if (limit) upstreamUrl.searchParams.set('limit', limit);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { items: [], warning: 'apps/api is unreachable — automation data is unavailable.' },
      { status: 200 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  body.owner_privy_id = session.privyId;

  const env = getServerEnv();
  try {
    const upstream = await fetch(`${env.leashApiUrl}/v1/platform/automations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.leashApiAdminSecret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', message: 'apps/api is offline; automation not saved.' },
      { status: 503 },
    );
  }
}
