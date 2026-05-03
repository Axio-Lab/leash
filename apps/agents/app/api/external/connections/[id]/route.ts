import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/external/connections/{id}` — proxies the apps/api admin
 * read endpoint and enforces "owner must match signed-in user" before
 * returning the row. apps/api also enforces ownership semantically (it
 * doesn't filter by privy id on `GET /{id}`), so this BFF wraps it.
 */
async function loadAndAuthorize(
  privyId: string,
  id: string,
): Promise<
  { ok: true; row: Record<string, unknown> } | { ok: false; status: number; body: string }
> {
  const env = getServerEnv();
  const res = await fetch(`${env.leashApiUrl}/v1/external/connections/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text };
  try {
    // apps/api returns the wire row directly (NOT `{connection: ...}`).
    const conn = JSON.parse(text) as Record<string, unknown>;
    if (!conn || conn.owner_privy_id !== privyId) {
      return { ok: false, status: 404, body: JSON.stringify({ error: 'not_found' }) };
    }
    return { ok: true, row: conn };
  } catch {
    return { ok: false, status: 502, body: JSON.stringify({ error: 'bad_upstream' }) };
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const r = await loadAndAuthorize(session.privyId, id);
  if (!r.ok) {
    return new NextResponse(r.body, {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  return NextResponse.json(r.row);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const auth = await loadAndAuthorize(session.privyId, id);
  if (!auth.ok) {
    return new NextResponse(auth.body, {
      status: auth.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const env = getServerEnv();
  const res = await fetch(`${env.leashApiUrl}/v1/external/connections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const auth = await loadAndAuthorize(session.privyId, id);
  if (!auth.ok) {
    return new NextResponse(auth.body, {
      status: auth.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const env = getServerEnv();
  const res = await fetch(`${env.leashApiUrl}/v1/external/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
