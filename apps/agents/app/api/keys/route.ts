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

type KeySource = 'agents' | 'marketplace' | 'shared' | 'unknown';

function inferSource(scopes: string[]): KeySource {
  const hasAgents = scopes.includes('agents');
  const hasMarketplace = scopes.includes('marketplace');
  if (hasAgents && hasMarketplace) return 'shared';
  if (hasAgents) return 'agents';
  if (hasMarketplace) return 'marketplace';
  return 'unknown';
}

/**
 * `GET /api/keys` — return every API key issued to the signed-in user.
 *
 * We join `platform_api_keys` (the BFF's record of which keys belong to
 * which Privy user) with `apps/api`'s `/v1/admin/api-keys?owner_wallet=…`
 * (the source of truth for status / network / last4). Keys that exist on
 * the API side but aren't tracked in `platform_api_keys` are still
 * returned so legacy bootstrap keys remain visible.
 */
export async function GET(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const db = getDb();
  await getOrCreateUser(db, {
    privyId: session.privyId,
    wallet: session.wallet,
    email: session.email,
  });
  const platformKeys = await listPlatformKeys(db, session.privyId);
  let apiKeys: Awaited<ReturnType<ReturnType<typeof getLeash>['listApiKeys']>> = [];
  try {
    apiKeys = await getLeash().listApiKeys({ ownerWallet: session.wallet, includeDisabled: true });
  } catch {
    // When apps/api is offline in local dev, still return platform-linked keys.
    apiKeys = [];
  }
  const platformIndex = new Map(platformKeys.map((p) => [p.keyId, p]));
  const items = apiKeys.map((k) => ({
    ...k,
    name: platformIndex.get(k.id)?.name ?? k.label,
    scopes: platformIndex.get(k.id)?.scopes ?? k.scopes ?? [],
    source: inferSource(platformIndex.get(k.id)?.scopes ?? k.scopes ?? []),
  }));
  return NextResponse.json({ items });
}

const ALLOWED_SCOPES: ApiScope[] = ['agents', 'marketplace'];

/**
 * `POST /api/keys` — issue a new `lsh_*` key for the signed-in user.
 *
 * Default network is `solana-devnet` and default scope is `["agents"]`
 * because this surface is `agent.leash.market`. The plaintext key is
 * returned ONCE in the response and then forgotten — same contract as
 * the underlying admin endpoint.
 */
export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
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
  const requestedScopes = Array.isArray(body.scopes) ? body.scopes : ['agents'];
  const scopes: ApiScope[] = requestedScopes.filter((s): s is ApiScope =>
    (ALLOWED_SCOPES as string[]).includes(s),
  );
  const finalScopes = scopes.length > 0 ? scopes : (['agents'] as ApiScope[]);
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
