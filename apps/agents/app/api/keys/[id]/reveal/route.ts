import { NextResponse, type NextRequest } from 'next/server';
import { listPlatformKeys } from '@leash/platform-auth';
import { LeashAdminError } from '@leash/platform-auth/leash-client';

import { getDb } from '@/lib/db';
import { getLeash } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/keys/{id}/reveal`
 *
 * Returns the plaintext value of an `lsh_*` key the signed-in user owns.
 * Backed by `apps/api`'s `/v1/admin/api-keys/:id/reveal`, which decrypts
 * the AES-GCM envelope persisted on creation.
 *
 * Authorization mirrors the DELETE flow: the user must own the key
 * either via `platform_api_keys` (Privy mapping) or `owner_wallet` on
 * the canonical row.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivySession(_req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const db = getDb();

  const platformKeys = await listPlatformKeys(db, session.privyId);
  const owns = platformKeys.some((k) => k.keyId === id);
  if (!owns) {
    try {
      const apiKeys = await getLeash().listApiKeys({
        ownerWallet: session.wallet,
        includeDisabled: true,
      });
      const apiOwns = apiKeys.some((k) => k.id === id);
      if (!apiOwns) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  try {
    const plaintext = await getLeash().revealApiKey(id);
    return NextResponse.json({ plaintext });
  } catch (e) {
    if (e instanceof LeashAdminError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: 'reveal_failed', message: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
