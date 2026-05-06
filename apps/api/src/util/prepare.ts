/**
 * Wrapper that turns a `prepare*` call from `@leashmarket/registry-utils` into
 * an HTTP-shaped response: an event row in Turso (`phase=prepared`), a
 * base64-encoded transaction the caller signs, and any echo fields the
 * underlying helper returned.
 *
 * Callers pass:
 *   - `kind`: which registry-utils helper this maps to (used as the
 *     event `kind` and to drive the explorer's icon/labels).
 *   - `prepared.builder`: the unsigned `TransactionBuilder` returned by
 *     the helper.
 *   - `echo`: the rest of the helper's return shape, surfaced to the
 *     caller verbatim so SDKs can use it without re-deriving PDAs.
 */

import type { Umi } from '@metaplex-foundation/umi';
import type { TransactionBuilder } from '@metaplex-foundation/umi';

import type { DbClient } from '../storage/turso.js';
import type { SvmNetwork } from './network.js';
import type { EventKind } from '../storage/events.js';
import { createPreparedEvent } from '../storage/events.js';
import { serializeBuilder, type WireTransaction } from './serialize.js';
import { ensureWatched } from '../indexer/watchlist.js';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';

export type PreparedResponse<TEcho> = {
  event_id: string;
  network: SvmNetwork;
  transaction: WireTransaction;
  echo: TEcho;
};

export type PreparedNoOpResponse<TEcho> = {
  event_id: null;
  network: SvmNetwork;
  transaction: null;
  echo: TEcho;
  no_op: true;
};

export type WrapPreparedArgs<TEcho> = {
  db: DbClient;
  umi: Umi;
  kind: EventKind;
  network: SvmNetwork;
  apiKeyId: string;
  clientReference?: string | null;
  agentAsset?: string | null;
  mint?: string | null;
  amountAtomic?: bigint | string | null;
  metadata?: Record<string, unknown>;
  builder: TransactionBuilder;
  echo: TEcho;
};

export async function wrapPrepared<TEcho>(
  args: WrapPreparedArgs<TEcho>,
): Promise<PreparedResponse<TEcho>> {
  const transaction = await serializeBuilder(args.umi, args.builder);
  const eventId = await createPreparedEvent(args.db, {
    kind: args.kind,
    network: args.network,
    apiKeyId: args.apiKeyId,
    clientReference: args.clientReference ?? null,
    agentAsset: args.agentAsset ?? null,
    mint: args.mint ?? null,
    amountAtomic:
      args.amountAtomic == null
        ? null
        : typeof args.amountAtomic === 'bigint'
          ? args.amountAtomic.toString()
          : args.amountAtomic,
    metadata: args.metadata,
  });
  // Auto-add the agent to the indexer watchlist so any future on-chain
  // activity for this asset shows up in the explorer feed even if the
  // SDK skips submit (e.g. caller broadcasts directly via their own
  // wallet). Best-effort: a missing agent_asset just means we couldn't
  // derive the treasury, in which case we silently skip — the indexer
  // can pick the agent up the next time `wrapPrepared` is called with
  // a real agent_asset.
  if (args.agentAsset) {
    try {
      const [treasury] = findAssetSignerPda(args.umi, { asset: publicKey(args.agentAsset) });
      await ensureWatched(args.db, {
        network: args.network,
        agentAsset: args.agentAsset,
        treasuryAddress: String(treasury),
      });
    } catch {
      // PDA derivation can fail if the pubkey is invalid; treat as best-effort.
    }
  }
  return {
    event_id: eventId,
    network: args.network,
    transaction,
    echo: args.echo,
  };
}

export function wrapNoOp<TEcho>(args: {
  network: SvmNetwork;
  echo: TEcho;
}): PreparedNoOpResponse<TEcho> {
  return {
    event_id: null,
    network: args.network,
    transaction: null,
    echo: args.echo,
    no_op: true,
  };
}
