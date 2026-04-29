'use client';

import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import type { Umi } from '@metaplex-foundation/umi';
import { createAgent } from '@leash/registry-utils';

import { SOLANA_NETWORK, type SolanaNetwork } from './env';

/**
 * Mints a new MPL Core asset registered as an agent (via Metaplex's
 * managed mint endpoint). Returns the asset pubkey + the deterministic
 * Asset Signer PDA that becomes the agent's treasury.
 *
 * The wallet plugged into `umi.identity` (Privy embedded wallet) pays
 * for and signs the transaction. After this returns, the BFF records
 * the platform-side row via `POST /api/agents`.
 */
export async function mintAgentBrowserSide(args: {
  umi: Umi;
  wallet: string;
  name: string;
  description: string;
  /** NFT metadata URI (off-chain JSON). For MVP we point to a hosted blob. */
  uri?: string;
  /** Defaults to app `NEXT_PUBLIC_SOLANA_NETWORK` / RPC-derived network. */
  network?: SolanaNetwork;
}): Promise<{ mint: string; treasury: string; signature: string }> {
  const uri =
    args.uri ??
    `data:application/json;utf8,${encodeURIComponent(
      JSON.stringify({
        name: args.name,
        description: args.description,
      }),
    )}`;
  const network = args.network ?? SOLANA_NETWORK;
  const result = await createAgent(args.umi, {
    wallet: args.wallet,
    name: args.name,
    uri,
    description: args.description,
    network,
  });
  const [treasury] = findAssetSignerPda(args.umi, { asset: publicKey(result.assetAddress) });
  return {
    mint: result.assetAddress,
    treasury: String(treasury),
    signature: result.signature,
  };
}
