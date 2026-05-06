/**
 * Resolve the Solana fee-payer pubkey that must be stamped on MPP
 * challenges (`request.feePayer`). It must be one of the facilitator
 * signers or settlement will fail with `mpp_fee_payer_not_managed`.
 *
 * Resolution order:
 *   1. `LEASH_API_MPP_FEE_PAYER_DEVNET` / `LEASH_API_MPP_FEE_PAYER_MAINNET`
 *   2. `GET {facilitator}/health` → first `signers[]` entry (cached per network)
 */

import { type LeashApiConfig, facilitatorForNetwork } from '../config.js';
import type { SvmNetwork } from './network.js';

const cache = new Map<SvmNetwork, string>();

export async function resolveMppFeePayer(
  config: LeashApiConfig,
  network: SvmNetwork,
): Promise<string> {
  const fromEnv =
    network === 'solana-mainnet'
      ? process.env.LEASH_API_MPP_FEE_PAYER_MAINNET?.trim()
      : process.env.LEASH_API_MPP_FEE_PAYER_DEVNET?.trim();
  if (fromEnv) return fromEnv;

  const hit = cache.get(network);
  if (hit) return hit;

  const base = facilitatorForNetwork(config, network).replace(/\/+$/, '');
  const r = await fetch(`${base}/health`);
  if (!r.ok) {
    throw new Error(`facilitator /health failed (${r.status}) — cannot resolve MPP fee payer`);
  }
  const j = (await r.json()) as { signers?: string[] };
  const first = j.signers?.[0];
  if (!first) {
    throw new Error('facilitator /health returned no `signers[]` — cannot host MPP paywalls');
  }
  cache.set(network, first);
  return first;
}
