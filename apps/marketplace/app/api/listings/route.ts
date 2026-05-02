import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateUser } from '@leash/platform-auth';

import { getDb } from '@/lib/db';
import { leashMarketplace } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/listings`  — public browse, proxies to `apps/api`.
 * `POST /api/listings` — authenticated; binds the listing to the
 *                       signed-in user's wallet + privy id and submits
 *                       it as `pending`.
 *
 * Single listing by human slug: `GET /api/listings/by-slug/{slug}` (see
 * `by-slug/[slug]/route.ts`). ULID-scoped rating/reviews stay under
 * `/api/listings/{id}/…` so Next never sees two sibling `[slug]` vs `[id]`.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = new URLSearchParams();
  for (const k of ['q', 'category', 'status', 'limit', 'owner_privy_id']) {
    const v = url.searchParams.get(k);
    if (v) q.set(k, v);
  }
  if (!q.has('status')) q.set('status', 'approved');
  try {
    const body = await leashMarketplace.listListings(q);
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream', message: (err as Error).message },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  await getOrCreateUser(getDb(), {
    privyId: session.privyId,
    wallet: session.wallet,
    email: session.email,
  });
  const payload = {
    ...body,
    owner_privy_id: session.privyId,
    owner_wallet: session.wallet,
  };
  try {
    const created = await leashMarketplace.createListing(payload);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    return NextResponse.json(
      { error: (err as { code?: string }).code ?? 'upstream', message: (err as Error).message },
      { status: status === 422 || status === 409 ? 422 : 502 },
    );
  }
}
