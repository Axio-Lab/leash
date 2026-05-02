import { NextResponse, type NextRequest } from 'next/server';
import {
  getOrCreateUser,
  listPlatformKeys,
  recordPlatformKey,
  type ApiScope,
} from '@leash/platform-auth';

import { getDb } from '@/lib/db';
import { getLeash } from '@/lib/leash';
import { resolvePrivySession } from '@/lib/privy-server';

const ALLOWED_SCOPES: ApiScope[] = ['agents', 'marketplace'];

const STATUS_TO_HTTP: Record<string, number> = {
  missing_token: 401,
  invalid_token: 401,
  lookup_failed: 502,
  no_solana_wallet: 409,
};

const STATUS_HINTS: Record<string, string> = {
  missing_token:
    'No Privy JWT on this request — sign in, or have the client send Authorization: Bearer <token>.',
  invalid_token:
    'JWT did not verify against this Privy app. Confirm PRIVY_APP_ID matches NEXT_PUBLIC_PRIVY_APP_ID and that PRIVY_APP_SECRET belongs to the same app.',
  lookup_failed:
    'Privy verified the JWT but lookup of the user record failed. Check the API server can reach api.privy.io and the app secret is current.',
  no_solana_wallet:
    'Your Privy account has no Solana wallet yet. Connect one (or wait for the embedded Solana wallet to be created) and retry.',
};

function authError(
  status: string,
  reason?: string,
  jwt?: { audience?: string; subject?: string; expired?: boolean },
) {
  const httpStatus = STATUS_TO_HTTP[status] ?? 401;
  const errorCode =
    status === 'no_solana_wallet'
      ? 'no_solana_wallet'
      : status === 'lookup_failed'
        ? 'privy_lookup_failed'
        : 'unauthenticated';
  return NextResponse.json(
    {
      error: errorCode,
      status,
      hint: STATUS_HINTS[status] ?? 'Authentication failed.',
      ...(process.env.NODE_ENV !== 'production'
        ? {
            ...(reason ? { reason } : {}),
            ...(jwt ? { jwt } : {}),
            debugUrl: '/api/debug/privy',
          }
        : {}),
    },
    { status: httpStatus, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(req: NextRequest) {
  const result = await resolvePrivySession(req);
  if (result.status !== 'ok') return authError(result.status, result.reason, result.jwt);
  const session = result.session;
  const db = getDb();
  await getOrCreateUser(db, {
    privyId: session.privyId,
    wallet: session.wallet,
    email: session.email,
  });
  let platformKeys;
  let apiKeys;
  try {
    [platformKeys, apiKeys] = await Promise.all([
      listPlatformKeys(db, session.privyId),
      getLeash().listApiKeys({ ownerWallet: session.wallet, includeDisabled: true }),
    ]);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'upstream_error';
    return NextResponse.json(
      { error: 'keys_upstream', message },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const platformIndex = new Map(platformKeys.map((p) => [p.keyId, p]));
  const items = apiKeys.map((k) => ({
    ...k,
    name: platformIndex.get(k.id)?.name ?? k.label,
    scopes: platformIndex.get(k.id)?.scopes ?? k.scopes ?? [],
  }));
  return NextResponse.json(
    { items },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  );
}

export async function POST(req: NextRequest) {
  const result = await resolvePrivySession(req);
  if (result.status !== 'ok') return authError(result.status, result.reason, result.jwt);
  const session = result.session;
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
