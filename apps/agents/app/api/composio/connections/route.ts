import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getComposio } from '@/lib/composio';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const composio = getComposio();
  if (!composio) {
    return NextResponse.json({ items: [] });
  }

  try {
    const listed = await composio.connectedAccounts.list({
      userIds: [session.privyId],
    });
    const items = 'items' in listed ? listed.items : [];
    return NextResponse.json({
      items: items.map((row) => {
        const r = row as {
          id?: string;
          status?: string;
          toolkit?: { slug?: string; name?: string };
        };
        return {
          id: r.id,
          status: r.status,
          toolkit_slug: r.toolkit?.slug,
          toolkit_name: r.toolkit?.name,
        };
      }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'composio_error';
    return NextResponse.json({ error: message, items: [] }, { status: 502 });
  }
}

const DeleteBody = z.object({ id: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const composio = getComposio();
  if (!composio) {
    return NextResponse.json({ error: 'composio_unconfigured' }, { status: 503 });
  }

  const body = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    await composio.connectedAccounts.delete(body.data.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'delete_failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
