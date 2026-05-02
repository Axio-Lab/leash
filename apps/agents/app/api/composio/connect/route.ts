import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getComposio } from '@/lib/composio';
import { requirePrivySession } from '@/lib/privy-server';

export const runtime = 'nodejs';

const BodySchema = z.object({
  toolkit_slug: z.string().min(1),
});

/**
 * Start OAuth — uses `composio.toolkits.authorize()` which auto-creates an
 * auth config for Composio-managed toolkits if one doesn't already exist,
 * then returns the redirect URL.
 */
export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const composio = getComposio();
  if (!composio) {
    return NextResponse.json({ error: 'composio_unconfigured' }, { status: 503 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const request = await composio.toolkits.authorize(session.privyId, parsed.data.toolkit_slug);
    return NextResponse.json({
      redirect_url: request.redirectUrl,
      connected_account_id: request.id,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'connect_failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
