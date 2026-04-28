import { NextResponse, type NextRequest } from 'next/server';
import {
  getOrCreateUser,
  listPlatformKeys,
  recordPlatformKey,
  type ApiScope,
} from '@leash/platform-auth';

import { getDb } from '@/lib/db';
import { getLeash } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

const ALLOWED_SCOPES: ApiScope[] = ['agents', 'marketplace'];

export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const db = getDb();
  await getOrCreateUser(db, {
    privyId: session.privyId,
    wallet: session.wallet,
    email: session.email,
  });
  const [platformKeys, apiKeys] = await Promise.all([
    listPlatformKeys(db, session.privyId),
    getLeash().listApiKeys({ ownerWallet: session.wallet, includeDisabled: true }),
  ]);
  const platformIndex = new Map(platformKeys.map((p) => [p.keyId, p]));
  const items = apiKeys.map((k) => ({
    ...k,
    name: platformIndex.get(k.id)?.name ?? k.label,
    scopes: platformIndex.get(k.id)?.scopes ?? k.scopes ?? [],
  }));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    network?: 'solana-devnet' | 'solana-mainnet';
    scopes?: string[];
  } | null;
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'name is required' },
      { status: 400 },
    );
  }
  const network: 'solana-devnet' | 'solana-mainnet' =
    body.network === 'solana-mainnet' ? 'solana-mainnet' : 'solana-devnet';
  const requestedScopes = Array.isArray(body.scopes) ? body.scopes : ['marketplace'];
  const scopes: ApiScope[] = requestedScopes.filter((s): s is ApiScope =>
    (ALLOWED_SCOPES as string[]).includes(s),
  );
  const finalScopes = scopes.length > 0 ? scopes : (['marketplace'] as ApiScope[]);
  const db = getDb();
  await getOrCreateUser(db, {
    privyId: session.privyId,
    wallet: session.wallet,
    email: session.email,
  });
  const created = await getLeash().createApiKey({
    label: body.name.trim(),
    network,
    ownerWallet: session.wallet,
    scopes: finalScopes,
  });
  await recordPlatformKey(db, {
    privyId: session.privyId,
    keyId: created.key.id,
    name: body.name.trim(),
    scopes: finalScopes,
  });
  return NextResponse.json(
    {
      key: { ...created.key, name: body.name.trim() },
      plaintext: created.plaintext,
    },
    { status: 201 },
  );
}
