import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateUser } from '@leash/platform-auth';

import { getDb } from '@/lib/db';
import { requirePrivySession } from '@/lib/privy-server';

export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  await getOrCreateUser(getDb(), {
    privyId: session.privyId,
    wallet: session.wallet,
    email: session.email,
  });
  return NextResponse.json({
    user: {
      privy_id: session.privyId,
      wallet: session.wallet,
      email: session.email ?? null,
    },
  });
}
