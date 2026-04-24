/**
 * Per-request Umi factory.
 *
 * The API never holds signing material — every prepare endpoint installs
 * `noopSigner(payer)` and `noopSigner(authority)` so `@leash/registry-utils`
 * builders compose without needing a real key. The caller signs the
 * resulting bytes locally.
 *
 * We cache one base Umi per network so blockhash subscriptions and
 * connection pools survive across requests.
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createNoopSigner,
  publicKey,
  signerIdentity,
  signerPayer,
  type Umi,
} from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { mplAgentIdentity, mplAgentTools } from '@metaplex-foundation/mpl-agent-registry';

import type { LeashApiConfig } from '../config.js';
import type { SvmNetwork } from './network.js';

/**
 * Install the program plugins every Leash flow needs:
 *   - mpl-toolbox: Associated Token Account program (`splAssociatedToken`)
 *   - mpl-core: required for `Execute` and `findAssetSignerPda`
 *   - mpl-agent-identity + mpl-agent-tools: identity + executive PDAs
 *
 * Without these, registry-utils' `findAssociatedTokenPda` /
 * `prepareSetSpendDelegation` etc. fail with "program name is not
 * recognized in the [devnet] cluster".
 */
function installPrograms(umi: Umi): Umi {
  umi.use(mplToolbox());
  umi.use(mplCore());
  umi.use(mplAgentIdentity());
  umi.use(mplAgentTools());
  return umi;
}

type CachedUmi = { umi: Umi; rpcUrl: string };
const baseCache = new Map<SvmNetwork, CachedUmi>();

function getBaseUmi(network: SvmNetwork, config: Pick<LeashApiConfig, 'rpc'>): Umi {
  const rpcUrl = config.rpc[network];
  const cached = baseCache.get(network);
  if (cached && cached.rpcUrl === rpcUrl) return cached.umi;
  const umi = installPrograms(createUmi(rpcUrl));
  baseCache.set(network, { umi, rpcUrl });
  return umi;
}

/**
 * Build a request-scoped Umi where `identity` and `payer` are noop
 * signers tied to the caller-provided pubkeys. The underlying RPC
 * connection is shared across requests on the same network.
 *
 * Pass `payer` as a base58 pubkey string (the caller's claimed fee
 * payer); pass `authority` to override the asset-owner signer (defaults
 * to the same as payer, which is what the registry-utils helpers
 * default to).
 */
export function umiForRequest(
  config: LeashApiConfig,
  args: { network: SvmNetwork; payer: string; authority?: string },
): Umi {
  // Touch the cached base so we benefit from any future per-network
  // initialization (RPC connection pool, blockhash subscription, …).
  void getBaseUmi(args.network, config);
  const payerSigner = createNoopSigner(publicKey(args.payer));
  const authoritySigner = createNoopSigner(publicKey(args.authority ?? args.payer));
  // `signerIdentity` and `signerPayer` install plugins; calling them on
  // the cached base would mutate the shared instance, so we shallow-
  // clone via `createUmi` and re-bind plugins. This is negligible (a
  // couple of hashmap inits) per request.
  const umi = installPrograms(createUmi(config.rpc[args.network]));
  umi.use(signerIdentity(authoritySigner, false));
  umi.use(signerPayer(payerSigner));
  return umi;
}

/**
 * Read-only Umi for endpoints that don't need signers (balance reads,
 * identity lookups, broadcasting a pre-signed tx).
 *
 * Accepts a minimal `{ rpc: Record<SvmNetwork, string> }` shape — the
 * full `LeashApiConfig` is a structural superset, but in-process
 * consumers (e.g. the explorer) only need to hand us the RPC URLs.
 */
export function umiReadOnly(config: Pick<LeashApiConfig, 'rpc'>, network: SvmNetwork): Umi {
  return getBaseUmi(network, config);
}
