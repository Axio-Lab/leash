import { NextResponse, type NextRequest } from 'next/server';
import { deriveAgentTreasuryAddress, listSplBalances } from '@leash/core';

import { SOLANA_RPC, SOLANA_NETWORK } from '@/lib/env';
import { requirePrivySession } from '@/lib/privy-server';

/**
 * `GET /api/agents/:mint/balances`
 *
 * Derives the treasury PDA from the asset mint, queries the Solana RPC
 * for SOL + every SPL/Token-2022 holding, and pins SOL/USDC/USDG/USDT
 * even when zero so the UI always renders the four tokens we promise.
 *
 * The session is required so we don't expose this as a free balance
 * lookup endpoint — but we don't yet bind the mint to the caller's
 * agents because that would require a full upstream join. Treasury
 * addresses are public on-chain anyway.
 */
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ mint: string }> }) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { mint } = await ctx.params;
  if (!mint || mint.length < 32) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  try {
    const treasury = await deriveAgentTreasuryAddress(mint);
    const result = await listSplBalances({
      owner: String(treasury),
      rpcUrl: SOLANA_RPC,
      network: SOLANA_NETWORK === 'solana-mainnet' ? 'mainnet' : 'devnet',
      pinKnownStables: true,
    });
    return NextResponse.json({
      treasury: String(treasury),
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'rpc_failure',
        message: e instanceof Error ? e.message : 'unknown',
      },
      { status: 502 },
    );
  }
}
