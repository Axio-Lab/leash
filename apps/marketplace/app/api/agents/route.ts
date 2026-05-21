import { NextResponse, type NextRequest } from 'next/server';

import { leashMarketplace } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const body = await leashMarketplace.listPlatformAgents(session.privyId);
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream', message: (err as Error).message },
      { status: 502 },
    );
  }
}
