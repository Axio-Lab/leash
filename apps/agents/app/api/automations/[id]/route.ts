import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

function automationUrl(id: string, ownerPrivyId: string): string {
  const env = getServerEnv();
  const url = new URL(`${env.leashApiUrl}/v1/platform/automations/${encodeURIComponent(id)}`);
  url.searchParams.set('owner_privy_id', ownerPrivyId);
  return url.toString();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const env = getServerEnv();
  try {
    const upstream = await fetch(automationUrl(id, session.privyId), {
      headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', message: 'apps/api is offline; automation unavailable.' },
      { status: 503 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  delete body.owner_privy_id;

  const env = getServerEnv();
  try {
    const upstream = await fetch(automationUrl(id, session.privyId), {
      method: 'PATCH',
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
      { error: 'upstream_unreachable', message: 'apps/api is offline; automation not updated.' },
      { status: 503 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const env = getServerEnv();
  try {
    const upstream = await fetch(automationUrl(id, session.privyId), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', message: 'apps/api is offline; automation not deleted.' },
      { status: 503 },
    );
  }
}
