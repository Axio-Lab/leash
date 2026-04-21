import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  delegateExecution,
  hasExecutiveProfile,
  isExecutionDelegated,
  registerExecutive,
} from '@leash/registry-utils';
import { getReadOnlyUmi, getServerUmi } from '@/lib/umi';

export const runtime = 'nodejs';

/**
 * GET /api/agents/executive?asset=<mint>&authority=<pubkey>
 *  → returns whether `authority` (the connected Privy wallet) has an
 *    ExecutiveProfile and whether `asset` execution is delegated to it.
 *
 *  This route is read-only and does NOT require a server-side signer.
 *
 * POST /api/agents/executive
 *  body: { action: 'register' }                           — registerExecutiveV1
 *  body: { action: 'delegate', asset: '<mint>' }          — delegateExecutionV1
 *
 *  POST is a server-side fallback for headless / scripted use; it requires
 *  `LEASH_DEV_PAYER_SECRET_KEY`. The web playground signs both actions
 *  directly in the browser via the Privy wallet — this endpoint exists for
 *  CI / cron / non-Privy callers.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const asset = url.searchParams.get('asset');
  const authority = url.searchParams.get('authority');

  if (!authority) {
    return NextResponse.json(
      { error: 'missing_authority', detail: 'Pass ?authority=<pubkey> (the executive wallet).' },
      { status: 400 },
    );
  }

  try {
    const umi = getReadOnlyUmi();
    const registered = await hasExecutiveProfile(umi, authority);
    let delegated: boolean | null = null;
    if (asset) {
      delegated = await isExecutionDelegated(umi, {
        agentAsset: asset,
        executiveAuthority: authority,
      });
    }
    return NextResponse.json({ authority, registered, delegated });
  } catch (err) {
    return NextResponse.json(
      { error: 'lookup_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register') }),
  z.object({ action: z.literal('delegate'), asset: z.string().min(32) }),
]);

export async function POST(req: Request): Promise<Response> {
  let parsed: z.infer<typeof Body>;
  try {
    const json = (await req.json()) as unknown;
    parsed = Body.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  let umi;
  try {
    umi = getServerUmi();
  } catch (err) {
    return NextResponse.json(
      { error: 'server_signer_unavailable', detail: (err as Error).message },
      { status: 503 },
    );
  }

  try {
    if (parsed.action === 'register') {
      const result = await registerExecutive(umi);
      return NextResponse.json({ ok: true, ...result });
    }
    const result = await delegateExecution(umi, {
      agentAsset: parsed.asset,
      executiveAuthority: String(umi.identity.publicKey),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: 'tx_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
