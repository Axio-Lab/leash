import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateUser } from '@leash/platform-auth';

import { getDb } from '@/lib/db';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/me` — verify the Privy session and upsert a `platform_users`
 * row. Returns the canonical user record. Used by every authed page in
 * the app to bootstrap.
 */
export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const db = getDb();
  const user = await getOrCreateUser(db, {
    privyId: session.privyId,
    wallet: session.wallet,
    email: session.email,
  });
  return NextResponse.json({ user });
}
