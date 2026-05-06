import { NextResponse } from 'next/server';
import { getAgentTreasury } from '@leashmarket/registry-utils';
import { listSplBalances, networkFromRpc } from '@leashmarket/core';
import { getReadOnlyUmi } from '@/lib/umi';
import { SOLANA_RPC } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * GET /api/agents/balance?asset=<mint>
 *
 * Returns the SOL balance plus all SPL token balances (Token + Token-2022)
 * held by the agent's Asset Signer PDA. Stables (USDC/USDT/USDG) are pinned
 * with zero balance when the agent doesn't hold them yet, so the UI can
 * always render them.
 *
 * The enumeration logic lives in `@leashmarket/core`'s `listSplBalances` so the
 * agent treasury endpoint and the wallet balance endpoint share one
 * canonical implementation.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const asset = url.searchParams.get('asset');
  if (!asset) {
    return NextResponse.json({ error: 'missing_asset' }, { status: 400 });
  }

  try {
    const umi = getReadOnlyUmi();
    const treasury = getAgentTreasury(umi, asset);
    const network = networkFromRpc(SOLANA_RPC);
    const result = await listSplBalances({ owner: treasury, rpcUrl: SOLANA_RPC, network });
    return NextResponse.json({ asset, treasury, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: 'balance_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
