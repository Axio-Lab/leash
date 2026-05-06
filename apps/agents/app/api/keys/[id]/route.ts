import { NextResponse, type NextRequest } from 'next/server';
import { listPlatformKeys, removePlatformKey } from '@leashmarket/platform-auth';

import { getDb } from '@/lib/db';
import { getLeash } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `DELETE /api/keys/{id}` — revoke an `lsh_*` key.
 *
 * We only allow the signed-in user to revoke a key that is recorded in
 * `platform_api_keys` for their own Privy id, OR that has the user's
 * wallet as its `owner_wallet` on the API side (covers legacy keys we
 * issued before this BFF existed).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
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
