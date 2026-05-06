import { NextResponse, type NextRequest } from 'next/server';
import { listPlatformKeys, removePlatformKey } from '@leashmarket/platform-auth';

import { getDb } from '@/lib/db';
import { getLeash } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const platformKeys = await listPlatformKeys(db, session.privyId);
  const owns = platformKeys.some((k) => k.keyId === id);
  if (!owns) {
    const apiKeys = await getLeash().listApiKeys({
      ownerWallet: session.wallet,
      includeDisabled: true,
    });
    const apiOwns = apiKeys.some((k) => k.id === id);
    if (!apiOwns) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }
  const after = await getLeash().disableApiKey(id);
  await removePlatformKey(db, { privyId: session.privyId, keyId: id });
  return NextResponse.json({ key: after });
}
