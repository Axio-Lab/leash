import { NextResponse, type NextRequest } from 'next/server';

import { isAdminPrivyId } from '@/lib/env';
import { leashMarketplace } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

const ALLOWED = new Set(['approved', 'rejected', 'disabled', 'pending']);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!isAdminPrivyId(session.privyId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { status?: string } | null;
  const status = String(body?.status ?? '');
  if (!ALLOWED.has(status)) {
    return NextResponse.json({ error: 'invalid_request', message: 'bad status' }, { status: 400 });
  }
  try {
    return NextResponse.json(await leashMarketplace.setStatus(id, { status }));
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream', message: (err as Error).message },
      { status: 502 },
    );
  }
}
