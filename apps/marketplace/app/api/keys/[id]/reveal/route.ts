import { NextResponse, type NextRequest } from 'next/server';
import { listPlatformKeys } from '@leash/platform-auth';
import { LeashAdminError } from '@leash/platform-auth/leash-client';

import { getDb } from '@/lib/db';
import { getLeash } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * Mirrors `apps/agents/app/api/keys/[id]/reveal/route.ts`. Marketplace
 * users can re-copy any key they own — both surfaces share the same
 * underlying admin endpoint.
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
