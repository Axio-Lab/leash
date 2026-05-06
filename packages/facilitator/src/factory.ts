/**
 * Convenience builders for spinning up a Leash-flavoured x402 facilitator.
 *
 * The flow:
 *
 *   1. `buildFacilitatorSigner` (./signer.ts) decodes the secret key
 *      from env into a {@link FacilitatorSvmSigner}.
 *   2. We instantiate `x402Facilitator` from `@x402/core` and register
 *      the SVM Exact scheme for v2 (`registerExactSvmScheme`) AND v1
 *      (`ExactSvmSchemeV1` via `registerV1`) so devnet clients on either
 *      protocol version can use us.
 *   3. `createFacilitatorHttpServer` (./http/server.ts) wraps it in
 *      a Hono app whose JSON shape matches `HTTPFacilitatorClient`.
 *
 * Networks default to **devnet only** for v0.1 of `facilitator.leash.dev`.
 * Mainnet support is unlocked by setting `LEASH_FACILITATOR_NETWORKS`
 * (see {@link parseNetworksEnv}) and topping up the signer with real SOL
 * for fees.
 */

import { x402Facilitator } from '@x402/core/facilitator';
import type { Network } from '@x402/core/types';
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, SOLANA_TESTNET_CAIP2 } from '@x402/svm';
import { SettlementCache } from '@x402/svm';
import {
  resolveLeashFeeAuthority,
  resolveLeashFeeBps,
  resolveLeashFeeEnforcement,
} from '@leashmarket/core';
import type { Hono } from 'hono';

import { createFacilitatorHttpServer } from './http/server.js';
import { registerLeashExactSvmScheme } from './schemes/index.js';
import {
  buildFacilitatorSigner,
  type LeashFacilitatorSignerOptions,
  type ResolvedFacilitatorSigner,
} from './signer.js';

export type LeashNetworkSlug = 'devnet' | 'testnet' | 'mainnet';

const NETWORK_TO_CAIP2: Record<LeashNetworkSlug, string> = {
  devnet: SOLANA_DEVNET_CAIP2,
  testnet: SOLANA_TESTNET_CAIP2,
  mainnet: SOLANA_MAINNET_CAIP2,
};

export const LEASH_FACILITATOR_BUILD = 'leash-facilitator/0.2';

export type CreateLeashFacilitatorOptions = LeashFacilitatorSignerOptions & {
  /**
   * Networks to register the Exact SVM scheme for. v0.1 of
   * `facilitator.leash.dev` ships **devnet only**; allow callers to
   * widen via env or programmatically.
   */
  networks?: readonly LeashNetworkSlug[];
};

export type LeashFacilitator = {
  app: Hono;
  facilitator: x402Facilitator;
  signer: ResolvedFacilitatorSigner;
  caip2Networks: readonly string[];
};

/**
 * Parse a comma-separated env value (`devnet`, `mainnet`, etc.) into
 * {@link LeashNetworkSlug}s. Unknown values throw early so misconfigured
 * deploys die at startup, not on the first verify call.
 */
function isNetworkSlug(s: string): s is LeashNetworkSlug {
  return s === 'devnet' || s === 'testnet' || s === 'mainnet';
}

export function parseNetworksEnv(raw: string | undefined): readonly LeashNetworkSlug[] {
  if (!raw) return ['devnet'];
  const slugs = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: LeashNetworkSlug[] = [];
  for (const slug of slugs) {
    if (!isNetworkSlug(slug)) {
      throw new Error(
        `LEASH_FACILITATOR_NETWORKS: unknown network "${slug}". Allowed: devnet, testnet, mainnet.`,
      );
    }
    out.push(slug);
  }
  return out.length === 0 ? ['devnet'] : out;
}

/**
 * Build a fully wired Leash facilitator. Both v1 and v2 of the Exact
 * SVM scheme are registered against the same signer so callers using
 * `HTTPFacilitatorClient` (v2) and the older v1 client both get answers.
 */
export async function createLeashFacilitator(
  opts: CreateLeashFacilitatorOptions,
): Promise<LeashFacilitator> {
  const slugs: readonly LeashNetworkSlug[] =
    opts.networks && opts.networks.length > 0 ? opts.networks : (['devnet'] as const);
  const networks = slugs.map((slug) => NETWORK_TO_CAIP2[slug]) as Network[];
  const networkArg: Network | Network[] = networks.length === 1 ? networks[0]! : networks;

  const signer = await buildFacilitatorSigner(opts);

  const facilitator = new x402Facilitator();
  // The Leash registrar handles BOTH v2 and v1 wire shapes, so we no
  // longer call the upstream `registerExactSvmScheme` + `registerV1`
  // separately. Both versions share a settlement cache internally so a
  // buyer can't double-settle by hopping protocol versions.
  registerLeashExactSvmScheme(facilitator, { signer: signer.signer, networks: networkArg });

  const mppSettlementCache = new SettlementCache();
  const app = createFacilitatorHttpServer({
    facilitator,
    signerAddresses: signer.addresses,
    networks,
    build: LEASH_FACILITATOR_BUILD,
    protocolFee: buildProtocolFeeHealthBlock(slugs),
    mpp: {
      signer: signer.signer,
      allowedCaip2Networks: new Set(networks),
      settlementCache: mppSettlementCache,
    },
  });

  return { app, facilitator, signer, caip2Networks: networks };
}

/**
 * Snapshot of the protocol-fee config used at startup. Surfaced on
 * `/health` so operators can confirm a deploy is in `enforce` mode
 * without grepping logs. Each enabled network gets its own block so a
 * single facilitator running both devnet + mainnet can advertise the
 * (possibly different) enforcement modes.
 */
function buildProtocolFeeHealthBlock(slugs: readonly LeashNetworkSlug[]): {
  bps: number;
  networks: Record<string, { enforce: string; authority: string }>;
} {
  const bps = resolveLeashFeeBps();
  const networks: Record<string, { enforce: string; authority: string }> = {};
  for (const slug of slugs) {
    if (slug === 'mainnet') {
      networks.mainnet = {
        enforce: resolveLeashFeeEnforcement('mainnet'),
        authority: resolveLeashFeeAuthority('mainnet'),
      };
    } else if (slug === 'devnet' || slug === 'testnet') {
      // Testnet shares the devnet authority/enforcement today.
      networks[slug] = {
        enforce: resolveLeashFeeEnforcement('devnet'),
        authority: resolveLeashFeeAuthority('devnet'),
      };
    }
  }
  return { bps, networks };
}
