import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateUser, listPlatformKeys } from '@leashmarket/platform-auth';

import { getDb } from '@/lib/db';
import { getServerEnv } from '@/lib/env';
import { getLeash } from '@/lib/leash';
import { requirePrivySession } from '@/lib/privy-server';

type InspectBody = {
  url?: string;
};

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as InspectBody | null;
  const id = parsePaymentLinkId(body?.url);
  if (!id) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Paste a Leash payable endpoint URL.' },
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
  const platformIndex = new Map(platformKeys.map((key) => [key.keyId, key]));
  const eligibleKeys = apiKeys.filter((key) => {
    const platformKey = platformIndex.get(key.id);
    const scopes = platformKey?.scopes ?? key.scopes ?? [];
    return !key.disabled_at && scopes.includes('marketplace');
  });
  if (eligibleKeys.length === 0) {
    return NextResponse.json(
      { error: 'no_key', message: 'Create a marketplace API key before inspecting endpoints.' },
      { status: 422 },
    );
  }

  const env = getServerEnv();
  for (const key of eligibleKeys) {
    try {
      const plaintext = await getLeash().revealApiKey(key.id);
      const upstream = await fetch(
        `${env.leashApiUrl}/v1/payment-links/${encodeURIComponent(id)}`,
        {
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${plaintext}`,
          },
        },
      );
      if (upstream.status === 404) continue;
      const parsed = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        const message =
          parsed && typeof parsed === 'object' && 'message' in parsed
            ? String(parsed.message)
            : `HTTP ${upstream.status}`;
        return NextResponse.json({ error: 'upstream', message }, { status: upstream.status });
      }
      return NextResponse.json(parsed);
    } catch {
      continue;
    }
  }

  return NextResponse.json(
    {
      error: 'not_found',
      message: 'No payment link matching that URL was found for your marketplace API keys.',
    },
    { status: 404 },
  );
}

function parsePaymentLinkId(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const raw = value.trim();
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const xIndex = parts.indexOf('x');
    if (xIndex >= 0 && parts[xIndex + 1]) return parts[xIndex + 1];
    return parts.at(-1) ?? null;
  } catch {
    return /^[a-z0-9-]{2,80}$/i.test(raw) ? raw : null;
  }
}
