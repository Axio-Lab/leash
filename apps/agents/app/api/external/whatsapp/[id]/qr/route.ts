import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/external/whatsapp/{id}/qr` — read the most recent
 * pairing QR + connection status for the polling UI.
 *
 * Polled by `external-add-whatsapp-modal` every ~2s. The endpoint is
 * intentionally cheap: a single `external_whatsapp_state` lookup +
 * a single `external_connections` lookup, no Baileys traffic.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const env = getServerEnv();

  // Ownership check first, then proxy the QR read. Both are admin-gated
  // so the user's Privy session never reaches apps/api directly.
  const ownerRes = await fetch(
    `${env.leashApiUrl}/v1/external/connections/${encodeURIComponent(id)}`,
    { headers: { authorization: `Bearer ${env.leashApiAdminSecret}` } },
  );
  if (!ownerRes.ok) {
    return new NextResponse(await ownerRes.text(), {
      status: ownerRes.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const connection = (await ownerRes.json()) as { owner_privy_id?: string };
  if (!connection || connection.owner_privy_id !== session.privyId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const res = await fetch(`${env.leashApiUrl}/v1/external/whatsapp/qr/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${env.leashApiAdminSecret}` },
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
