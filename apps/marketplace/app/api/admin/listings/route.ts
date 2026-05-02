import { NextResponse, type NextRequest } from 'next/server';

import { isAdminPrivyId } from '@/lib/env';
import { leashMarketplace } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/admin/listings?status=pending` — list listings in any
 * status. Used by the moderation queue page.
 */
export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!isAdminPrivyId(session.privyId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const q = new URLSearchParams();
  q.set('status', url.searchParams.get('status') ?? 'pending');
  if (url.searchParams.has('limit')) q.set('limit', url.searchParams.get('limit')!);
  try {
    return NextResponse.json(await leashMarketplace.listListings(q));
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream', message: (err as Error).message },
      { status: 502 },
    );
  }
}
