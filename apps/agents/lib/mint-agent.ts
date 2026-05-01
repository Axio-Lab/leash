'use client';

import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import type { Umi } from '@metaplex-foundation/umi';
import {
  buildRegistrationV1,
  createAgent,
  registrationToDataUrl,
  type RegistrationService,
} from '@leash/registry-utils';

import { SOLANA_NETWORK, type SolanaNetwork } from './env';

/**
 * Mints a new MPL Core asset registered as an agent (via Metaplex's
 * managed mint endpoint). Returns the asset pubkey + the deterministic
 * Asset Signer PDA that becomes the agent's treasury.
 *
 * The wallet plugged into `umi.identity` (Privy embedded wallet) pays
 * for and signs the transaction. After this returns, the BFF records
 * the platform-side row via `POST /api/agents`.
 *
 * We attach two metadata payloads to the mint:
 *
 * 1. **On-chain `agentMetadata`** — Metaplex's MPL agent registry
 *    block. Carries `name`, `description`, `services[]`, etc., and is
 *    queryable via the registry program directly.
 *
 * 2. **Off-chain `uri`** — an EIP-8004 RegistrationV1 JSON document.
 *    Encoded as a `data:application/json;…` URL so we don't need to
 *    host a separate file. Any wallet, indexer, or explorer that
 *    follows the agent's `uri` field gets the full standardised
 *    profile (image, services, x402Support, supportedTrust, …).
 */
export async function mintAgentBrowserSide(args: {
  umi: Umi;
  wallet: string;
  name: string;
  description: string;
  /**
   * Public URL of the agent's profile image. Embedded as `image` in
   * the RegistrationV1 doc. Pass empty string / undefined to skip.
   */
  image?: string | null;
  /**
   * Free-form `services` discovered by the agent. Leash always injects
   * a `receipts` entry, so callers don't need to.
   */
  services?: RegistrationService[];
  /** Default true — set false to mint a paused agent. */
  active?: boolean;
  /** Default true — flip if the agent doesn't answer x402 paywall flows. */
  x402Support?: boolean;
  /** Defaults to app `NEXT_PUBLIC_SOLANA_NETWORK` / RPC-derived network. */
  network?: SolanaNetwork;
}): Promise<{
  mint: string;
  treasury: string;
  signature: string;
  /** The RegistrationV1 doc we attached, for client-side echo + persistence. */
  registrationUrl: string;
}> {
  const network = args.network ?? SOLANA_NETWORK;
  const services = args.services ?? [];
  const registration = buildRegistrationV1({
    name: args.name,
    description: args.description,
    image: args.image ?? '',
    services,
    active: args.active ?? true,
    x402Support: args.x402Support ?? true,
  });
  const uri = registrationToDataUrl(registration);
  const result = await createAgent(args.umi, {
    wallet: args.wallet,
    name: args.name,
    uri,
    description: args.description,
    network,
    services,
  });
  const [treasury] = findAssetSignerPda(args.umi, { asset: publicKey(result.assetAddress) });
  return {
    mint: result.assetAddress,
    treasury: String(treasury),
    signature: result.signature,
    registrationUrl: uri,
  };
}
