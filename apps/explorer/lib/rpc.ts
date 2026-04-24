/**
 * Direct Solana RPC reads for the explorer.
 *
 * The agent page renders identity + treasury balances, both of which
 * are pure RPC reads. We skip the API entirely and call the same
 * `@leash/api` snapshot helpers in-process — same logic, same shape,
 * one fewer hop.
 *
 * Configure with:
 *
 *   LEASH_RPC_DEVNET     (default: https://api.devnet.solana.com)
 *   LEASH_RPC_MAINNET    (default: https://api.mainnet-beta.solana.com)
 *
 * For backwards compatibility we also accept `LEASH_API_RPC_DEVNET` /
 * `LEASH_API_RPC_MAINNET` so a shared infra `.env` can drive both
 * processes.
 */

import {
  getAgentSummary,
  getAgentTreasuryBalances,
  umiReadOnly,
  type SvmNetwork,
} from '@leash/api';
import type { Umi } from '@metaplex-foundation/umi';

import type { Network } from './network';
import { networkToSlug } from './network';
import type { AgentSummary, TreasuryBalances } from './types';

function rpcUrl(network: SvmNetwork): string {
  if (network === 'solana-mainnet') {
    return (
      process.env.LEASH_RPC_MAINNET ||
      process.env.LEASH_API_RPC_MAINNET ||
      'https://api.mainnet-beta.solana.com'
    );
  }
  return (
    process.env.LEASH_RPC_DEVNET ||
    process.env.LEASH_API_RPC_DEVNET ||
    'https://api.devnet.solana.com'
  );
}

/**
 * Build the minimal `{ rpc }` config slice `umiReadOnly` needs. The
 * underlying helper caches one Umi per `(network, rpcUrl)` pair, so
 * repeated calls don't keep re-creating connections.
 */
function umiFor(network: SvmNetwork): Umi {
  return umiReadOnly(
    {
      rpc: {
        'solana-devnet': rpcUrl('solana-devnet'),
        'solana-mainnet': rpcUrl('solana-mainnet'),
      },
    },
    network,
  );
}

export class RpcUnavailableError extends Error {
  constructor(network: Network, message: string) {
    super(`Solana RPC (${network}) unreachable: ${message}`);
    this.name = 'RpcUnavailableError';
  }
}

export class AgentNotFoundError extends Error {
  constructor(mint: string, network: Network) {
    super(`Agent ${mint} not found on ${network}`);
    this.name = 'AgentNotFoundError';
  }
}

export async function getAgentSummaryFor(network: Network, mint: string): Promise<AgentSummary> {
  const slug = networkToSlug(network);
  try {
    return await getAgentSummary(umiFor(slug), slug, mint);
  } catch (err) {
    throw new RpcUnavailableError(network, (err as Error).message);
  }
}

export async function getTreasuryBalancesFor(
  network: Network,
  mint: string,
): Promise<TreasuryBalances> {
  const slug = networkToSlug(network);
  try {
    return await getAgentTreasuryBalances(umiFor(slug), slug, mint);
  } catch (err) {
    throw new RpcUnavailableError(network, (err as Error).message);
  }
}
