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
  if (!session) {
    if (process.env.NODE_ENV === 'development') {
      const auth = req.headers.get('authorization');
      const hasBearer = typeof auth === 'string' && /^Bearer\s+\S+/i.test(auth);
      const hasXPrivy = !!req.headers.get('x-privy-access-token')?.trim();
      const hasPrivyCookie = !!req.cookies.get('privy-token')?.value;
      return NextResponse.json(
        {
          error: 'unauthenticated',
          debug: {
            hasAuthorizationBearer: hasBearer,
            hasXPrivyAccessToken: hasXPrivy,
            hasPrivyTokenCookie: hasPrivyCookie,
            hint:
              !hasBearer && !hasXPrivy && !hasPrivyCookie
                ? 'No Privy JWT on this request — client should send Bearer or x-privy-access-token after sign-in.'
                : 'JWT arrived but verify failed or user has no Solana wallet for this app. Confirm PRIVY_APP_ID === NEXT_PUBLIC_PRIVY_APP_ID, PRIVY_APP_SECRET matches that app, and the user has a Solana wallet.',
          },
        },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
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
