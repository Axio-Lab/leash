import { NextResponse } from 'next/server';
import { listSplBalances, networkFromRpc } from '@leashmarket/core';
import { SOLANA_RPC } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * GET /api/wallet/balance?owner=<pubkey>
 *
 * Returns SOL + SPL token balances for any Solana pubkey. We use this to
 * surface the connected Privy wallet's USDC/SOL balance on the buyer
 * playground so users immediately see whether they can afford the next
 * x402 spend.
 *
 * The actual enumeration logic lives in `@leashmarket/core`'s `listSplBalances`
 * so the SDK and the playground share one canonical balance shape.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const owner = url.searchParams.get('owner');
  if (!owner) return NextResponse.json({ error: 'missing_owner' }, { status: 400 });

  try {
    const network = networkFromRpc(SOLANA_RPC);
    const result = await listSplBalances({ owner, rpcUrl: SOLANA_RPC, network });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'balance_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
