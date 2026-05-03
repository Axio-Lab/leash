import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `POST /api/external/connections/{id}/refresh` — rotate the
 * verification_token so the user can re-pair Telegram with a fresh
 * `/start <token>` link. Mirrors the admin endpoint on apps/api.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const env = getServerEnv();

  // Authorize: only refresh tokens for connections owned by the signed-in user.
  // The GET endpoint returns the wire row directly (no wrapper).
  const fetchRes = await fetch(
    `${env.leashApiUrl}/v1/external/connections/${encodeURIComponent(id)}`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  if (!fetchRes.ok) {
    return new NextResponse(await fetchRes.text(), {
      status: fetchRes.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const connection = (await fetchRes.json()) as { owner_privy_id?: string };
  if (!connection || connection.owner_privy_id !== session.privyId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const res = await fetch(
    `${env.leashApiUrl}/v1/external/connections/${encodeURIComponent(id)}/refresh`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
    },
  );
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
