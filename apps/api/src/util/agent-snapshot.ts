/**
 * Shared, library-friendly view of an agent's on-chain state.
 *
 * `routes/agents.ts` exposes this over HTTP for SDK consumers, but the
 * Leash Explorer (an internal Next.js app that ships in the same infra
 * boundary as the API) imports the same functions directly so it can
 * skip the network hop entirely. Anything in this module is pure RPC —
 * no auth, no DB writes — so it's safe to re-use from any caller that
 * already has a `Umi` and a network slug.
 *
 * The shape returned here is deliberately the same JSON the public
 * REST endpoints emit, so the explorer (and any other in-process
 * consumer) doesn't need its own translation layer.
 */

import {
  getAgentToken,
  getTreasurySolBalance,
  KNOWN_STABLES,
  type AgentTokenStatus,
  type TreasurySolBalance,
} from '@leashmarket/registry-utils';
import {
  safeFetchAgentIdentityV1FromSeeds,
  safeFetchAgentIdentityV2FromSeeds,
} from '@metaplex-foundation/mpl-agent-registry';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import { publicKey, type PublicKey, type Umi } from '@metaplex-foundation/umi';

import type { SvmNetwork } from './network.js';

export type AgentIdentitySource = 'v1' | 'v2';

export type AgentSummary = {
  agent_asset: string;
  network: SvmNetwork;
  treasury: string;
  has_identity: boolean;
  identity: { source: AgentIdentitySource; asset: string } | null;
  token: {
    has_token: boolean;
    mint: string | null;
    source: 'v1' | 'v2' | 'none';
  };
};

export type AgentSplBalance = {
  mint: string;
  symbol: string | null;
  ata: string;
  token_program: string;
  amount: string;
  decimals: number;
  ui_amount: number;
};

export type AgentTreasuryBalances = {
  agent_asset: string;
  network: SvmNetwork;
  treasury: string;
  sol: {
    lamports: string;
    sol: number;
    spendable_lamports: string;
    spendable_sol: number;
  };
  spl: AgentSplBalance[];
};

/** Both reads merged for callers (e.g. explorer) that want one round trip. */
export type AgentSnapshot = AgentSummary & {
  balances: AgentTreasuryBalances;
};

/**
 * Identity + token + treasury PDA. Matches `GET /v1/agents/{mint}`.
 *
 * Identity falls back from v2 → v1 because mpl-agent-registry v2 is
 * the only forward-compatible variant we expect to mint going forward,
 * but v1 records still exist on devnet and the explorer must surface
 * them as registered.
 */
export async function getAgentSummary(
  umi: Umi,
  network: SvmNetwork,
  mint: string,
): Promise<AgentSummary> {
  const asset = publicKey(mint);
  const [treasury] = findAssetSignerPda(umi, { asset });
  const v2 = await safeFetchAgentIdentityV2FromSeeds(umi, { asset });
  const v1 = v2 == null ? await safeFetchAgentIdentityV1FromSeeds(umi, { asset }) : null;
  const identity =
    v2 != null
      ? { source: 'v2' as const, asset: String(v2.asset) }
      : v1 != null
        ? { source: 'v1' as const, asset: String(v1.asset) }
        : null;
  const tokenStatus: AgentTokenStatus = await getAgentToken(umi, asset);
  return {
    agent_asset: mint,
    network,
    treasury: String(treasury),
    has_identity: identity != null,
    identity,
    token: {
      has_token: tokenStatus.hasToken,
      mint: tokenStatus.mint,
      source: tokenStatus.source,
    },
  };
}

/**
 * Native SOL + curated stable balances on the agent's treasury PDA.
 * Matches `GET /v1/agents/{mint}/treasury/balances`.
 *
 * SPL reads are best-effort: an RPC blip surfaces as a zero balance,
 * not a 5xx, so the explorer's treasury panel still renders.
 */
export async function getAgentTreasuryBalances(
  umi: Umi,
  network: SvmNetwork,
  mint: string,
): Promise<AgentTreasuryBalances> {
  const asset = publicKey(mint);
  const sol: TreasurySolBalance = await getTreasurySolBalance(umi, { agentAsset: asset });
  const spl = await readKnownSplBalances(umi, network, asset);
  return {
    agent_asset: mint,
    network,
    treasury: sol.treasury,
    sol: {
      lamports: sol.lamports.toString(),
      sol: sol.sol,
      spendable_lamports: sol.spendableLamports.toString(),
      spendable_sol: sol.spendableSol,
    },
    spl,
  };
}

/**
 * Convenience wrapper for callers (notably the explorer's agent page)
 * that want both the summary and balances in a single function call.
 * Issues both reads in parallel.
 */
export async function getAgentSnapshot(
  umi: Umi,
  network: SvmNetwork,
  mint: string,
): Promise<AgentSnapshot> {
  const [summary, balances] = await Promise.all([
    getAgentSummary(umi, network, mint),
    getAgentTreasuryBalances(umi, network, mint),
  ]);
  return { ...summary, balances };
}

async function readKnownSplBalances(
  umi: Umi,
  network: SvmNetwork,
  asset: PublicKey,
): Promise<AgentSplBalance[]> {
  const [treasury] = findAssetSignerPda(umi, { asset });
  const stables = KNOWN_STABLES[network];
  const out: AgentSplBalance[] = [];
  for (const s of stables) {
    const [ata] = findAssociatedTokenPda(umi, {
      mint: s.mint,
      owner: treasury,
      tokenProgramId: s.tokenProgram,
    });
    let amount = 0n;
    let decimals = 6;
    try {
      const acc = await umi.rpc.getAccount(ata);
      if (acc.exists && acc.data.length >= 72) {
        const dv = new DataView(acc.data.buffer, acc.data.byteOffset, acc.data.byteLength);
        amount = dv.getBigUint64(64, true);
      }
      const mintAcc = await umi.rpc.getAccount(s.mint);
      if (mintAcc.exists && mintAcc.data.length >= 45) {
        decimals = mintAcc.data[44] ?? 6;
      }
    } catch {
      // Network/RPC blip — surface as zero balance, not a 5xx.
    }
    out.push({
      mint: String(s.mint),
      symbol: s.symbol ?? null,
      ata: String(ata),
      token_program: String(s.tokenProgram),
      amount: amount.toString(),
      decimals,
      ui_amount: Number(amount) / Math.pow(10, decimals),
    });
  }
  return out;
}
