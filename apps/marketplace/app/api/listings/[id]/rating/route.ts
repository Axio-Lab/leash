import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateUser } from '@leash/platform-auth';

import { getDb } from '@/lib/db';
import { leashMarketplace } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { stars?: number } | null;
  const stars = Number(body?.stars ?? 0);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'stars must be 1..5' },
      { status: 400 },
    );
  }
  await getOrCreateUser(getDb(), {
    privyId: session.privyId,
    wallet: session.wallet,
    email: session.email,
  });
  try {
    const summary = await leashMarketplace.rate(id, { privy_id: session.privyId, stars });
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream', message: (err as Error).message },
      { status: 502 },
    );
  }
}
