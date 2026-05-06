'use client';

import {
  KNOWN_STABLES,
  provisionTreasuryAtas,
  setSpendDelegation,
} from '@leashmarket/registry-utils';
import { publicKey } from '@metaplex-foundation/umi';
import type { Umi } from '@metaplex-foundation/umi';

import { SOLANA_NETWORK, type SolanaNetwork } from './env';

/**
 * Default per-stablecoin allowance approved to the executive on agent
 * setup. 100 USDC/USDT/USDG (atomic, 6 decimals). Operators can refresh
 * later from `/profile/agent` once we wire revoke/raise into the UI.
 */
const DEFAULT_DELEGATION_ATOMIC = 100_000_000n;

/**
 * Wait until `assetAddress` is visible on the wallet's RPC — the freshly
 * minted Core asset is what mpl-core's `Execute` checks, and on devnet
 * propagation between the Metaplex relayer and the public RPC the wallet
 * simulates against routinely takes 1–4 seconds. Skipping this leads
 * directly to "Invalid Asset passed in" (0x18).
 */
async function waitForAssetVisible(
  umi: Umi,
  assetAddress: string,
  args: { timeoutMs?: number; intervalMs?: number; onProgress?: (msg: string) => void } = {},
): Promise<void> {
  const timeoutMs = args.timeoutMs ?? 45_000;
  const intervalMs = args.intervalMs ?? 1_500;
  const started = Date.now();
  let attempt = 0;
  while (true) {
    attempt += 1;
    const acct = await umi.rpc.getAccount(publicKey(assetAddress));
    if (acct.exists) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        'Agent record is not visible to the network yet — wait a few seconds and retry.',
      );
    }
    args.onProgress?.(`Waiting for the network to see your agent (attempt ${attempt})…`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Step 2 of onboarding: provision treasury ATAs (USDC/USDT/USDG) for the
 * freshly minted agent. Idempotent — re-running is a no-op once every
 * supported stablecoin ATA exists.
 */
export async function provisionAgentTreasury(args: {
  umi: Umi;
  agentMint: string;
  network?: SolanaNetwork;
  onProgress?: (msg: string) => void;
}): Promise<void> {
  const net = args.network ?? SOLANA_NETWORK;
  args.onProgress?.('Confirming agent record on-chain…');
  await waitForAssetVisible(args.umi, args.agentMint, { onProgress: args.onProgress });
  args.onProgress?.('Creating USDC, USDT and USDG accounts…');
  await provisionTreasuryAtas(args.umi, {
    agentAsset: args.agentMint,
    network: net,
  });
}

/**
 * Step 3 of onboarding: approve `executive` as the spend delegate for the
 * agent's stablecoin treasury. We approve all three stablecoins at once
 * so the agent can pay in any of them out of the box.
 *
 * Each token approval is its own transaction (signed by the connected
 * wallet) so a failure on one mint does not strand the others.
 */
export async function delegateAgentSpend(args: {
  umi: Umi;
  agentMint: string;
  /** Wallet that gets spend authority (default: connected Privy wallet). */
  executive: string;
  network?: SolanaNetwork;
  /** Per-mint atomic cap. Defaults to 100.000000 of each stable. */
  amount?: bigint;
  onProgress?: (msg: string) => void;
}): Promise<{ approved: Array<{ symbol: string; signature: string }> }> {
  const net = args.network ?? SOLANA_NETWORK;
  const cap = args.amount ?? DEFAULT_DELEGATION_ATOMIC;
  const stables = KNOWN_STABLES[net === 'solana-mainnet' ? 'solana-mainnet' : 'solana-devnet'];

  const approved: Array<{ symbol: string; signature: string }> = [];
  for (const stable of stables) {
    args.onProgress?.(`Approving ${stable.symbol} spend allowance…`);
    const res = await setSpendDelegation(args.umi, {
      agentAsset: args.agentMint,
      mint: stable.mint,
      executive: args.executive,
      amount: cap,
      tokenProgram: stable.tokenProgram,
    });
    approved.push({ symbol: stable.symbol, signature: res.signature });
  }
  return { approved };
}

/**
 * Convenience wrapper — runs provision + delegation in sequence.
 * Use this when the caller wants the legacy "do it all" semantics.
 */
export async function provisionAndDelegateAgent(args: {
  umi: Umi;
  agentMint: string;
  executive: string;
  network?: SolanaNetwork;
  onProgress?: (msg: string) => void;
}): Promise<void> {
  await provisionAgentTreasury({
    umi: args.umi,
    agentMint: args.agentMint,
    network: args.network,
    onProgress: args.onProgress,
  });
  await delegateAgentSpend({
    umi: args.umi,
    agentMint: args.agentMint,
    executive: args.executive,
    network: args.network,
    onProgress: args.onProgress,
  });
}
