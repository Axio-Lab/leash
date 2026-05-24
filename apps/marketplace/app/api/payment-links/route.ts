import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateUser, listPlatformKeys } from '@leashmarket/platform-auth';

import { getDb } from '@/lib/db';
import { getServerEnv } from '@/lib/env';
import { getLeash } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

type PaymentLinkRequest = {
  key_id?: string;
  label?: string;
  description?: string;
  owner_agent?: string;
  method?: 'GET' | 'POST';
  protocol?: 'x402' | 'mpp';
  price?: string;
  currency?: 'USDC' | 'USDT' | 'USDG';
  accepts_currencies?: Array<'USDC' | 'USDT' | 'USDG'>;
  response?: { status: number; mimeType: string; body: unknown };
  metadata?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as PaymentLinkRequest | null;
  if (!body || !body.key_id) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'key_id is required' },
      { status: 400 },
    );
  }

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
  const platformKey = platformKeys.find((key) => key.keyId === body.key_id);
  const apiKey = apiKeys.find((key) => key.id === body.key_id);
  if (!platformKey || !apiKey || apiKey.disabled_at) {
    return NextResponse.json(
      { error: 'invalid_key', message: 'Select an active marketplace API key.' },
      { status: 422 },
    );
  }
  const scopes = platformKey.scopes ?? apiKey.scopes ?? [];
  if (!scopes.includes('marketplace')) {
    return NextResponse.json(
      { error: 'invalid_key', message: 'Selected key needs marketplace scope.' },
      { status: 422 },
    );
  }

  const plaintext = await getLeash().revealApiKey(body.key_id);
  const env = getServerEnv();
  const payload: Omit<PaymentLinkRequest, 'key_id'> = { ...body };
  delete (payload as PaymentLinkRequest).key_id;
  const upstream = await fetch(`${env.leashApiUrl}/v1/payment-links`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${plaintext}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await upstream.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: 'invalid_response', message: text };
    }
  }
  return NextResponse.json(parsed, { status: upstream.status });
}
