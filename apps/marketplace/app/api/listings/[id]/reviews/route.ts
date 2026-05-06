import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateUser } from '@leashmarket/platform-auth';

import { getDb } from '@/lib/db';
import { leashMarketplace } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await leashMarketplace.listReviews(id));
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream', message: (err as Error).message },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { body?: string } | null;
  const text = (body?.body ?? '').trim();
  if (text.length === 0 || text.length > 2000) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'review body must be 1..2000 chars' },
      { status: 400 },
    );
  }
  await getOrCreateUser(getDb(), {
    privyId: session.privyId,
    wallet: session.wallet,
    email: session.email,
  });
  try {
    const review = await leashMarketplace.addReview(id, {
      privy_id: session.privyId,
      body: text,
    });
    return NextResponse.json(review, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream', message: (err as Error).message },
      { status: 502 },
    );
  }
}
