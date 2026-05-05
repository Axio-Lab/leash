import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `POST /api/external/whatsapp/{id}/start` — open (or resume) the
 * Baileys session for a WhatsApp connection.
 *
 * BFF rules: (a) ownership check — the signed-in user must own this
 * connection, (b) channel check — the WhatsApp routes only apply to
 * `channel='whatsapp'`, (c) we forward whatever shape apps/api
 * returns (which already includes `status` and an optional
 * `reason`).
 *
 * Failure modes worth flagging in the UI:
 *   - 503 from apps/api → "WhatsApp bridge is disabled on this
 *     replica" (operator hasn't set LEASH_WHATSAPP_ENABLED=1).
 *   - 200 with `status='error'` → Baileys couldn't construct the
 *     socket (encryption key missing, network down, etc).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const env = getServerEnv();

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
  const connection = (await fetchRes.json()) as {
    owner_privy_id?: string;
    channel?: string;
  };
  if (!connection || connection.owner_privy_id !== session.privyId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (connection.channel !== 'whatsapp') {
    return NextResponse.json({ error: 'wrong_channel' }, { status: 409 });
  }

  const res = await fetch(
    `${env.leashApiUrl}/v1/external/whatsapp/start/${encodeURIComponent(id)}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
    },
  );
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
