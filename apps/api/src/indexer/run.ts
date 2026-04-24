/**
 * Indexer main loop.
 *
 * One pass per network per tick. The loop:
 *   1. Loads the watchlist for the network.
 *   2. For each `(address, kind)` row, pages through
 *      `getSignaturesForAddress(address)` newest-first until it reaches
 *      `last_signature` (or the end of history on a fresh row).
 *   3. For each signature, fetches the parsed transaction and decodes
 *      it. Matching events are written via `ingestChainEvent` (idempotent
 *      on `(network, signature, kind, mint)`).
 *   4. Updates the cursor to the *newest* signature it observed so the
 *      next pass starts from there.
 *
 * The loop is single-process by design — Phase 6 will add Redis-based
 * worker locks if we ever scale horizontally. For now, two indexer
 * processes pointed at the same DB will produce duplicate event ROWS,
 * which `ingestChainEvent`'s dedup absorbs gracefully.
 */

import type { DbClient } from '../storage/turso.js';
import { ingestChainEvent } from '../storage/events.js';
import type { SvmNetwork } from '../util/network.js';
import type { RpcClient } from './rpc.js';
import { decodeTransaction } from './decode.js';
import { getCursor, listWatchlist, upsertCursor, type WatchKind } from './watchlist.js';

export type IndexerOptions = {
  /**
   * Maximum number of signatures to walk per `(address, kind)` per tick.
   * Caps the cost of catching up on a backfilled watchlist.
   */
  perAddressLimit?: number;
  /**
   * Sleep between transactions in milliseconds. Lets us stay under
   * Helius / public RPC rate limits without explicit token-bucketing.
   */
  perTxDelayMs?: number;
  /**
   * Optional logger. Defaults to `console.log` with a `[indexer]` prefix.
   */
  log?: (line: string) => void;
};

export type IndexerTickResult = {
  network: SvmNetwork;
  addressesScanned: number;
  signaturesFetched: number;
  eventsWritten: number;
  errors: number;
};

/**
 * Run a single indexer pass for one network. Returns a summary the
 * caller can log / surface in `/v1/indexer/status` later. Errors on
 * individual addresses are caught and counted; we never let one bad
 * watchlist row break the rest of the pass.
 */
export async function runIndexerTick(args: {
  db: DbClient;
  rpc: RpcClient;
  network: SvmNetwork;
  options?: IndexerOptions;
}): Promise<IndexerTickResult> {
  const { db, rpc, network } = args;
  const opts = args.options ?? {};
  const perAddrLimit = Math.min(Math.max(opts.perAddressLimit ?? 200, 1), 1000);
  const log = opts.log ?? ((line: string) => console.log(`[indexer] ${line}`));

  const result: IndexerTickResult = {
    network,
    addressesScanned: 0,
    signaturesFetched: 0,
    eventsWritten: 0,
    errors: 0,
  };

  const watchlist = await listWatchlist(db, network);
  for (const watch of watchlist) {
    result.addressesScanned += 1;
    try {
      const cursor = await getCursor(db, {
        network,
        address: watch.address,
        kind: watch.kind,
      });
      // `until` tells the RPC "stop when you hit this signature again",
      // which is how we avoid re-walking the full history on every tick.
      const sigs = await rpc.getSignaturesForAddress({
        network,
        address: watch.address,
        ...(cursor?.lastSignature ? { until: cursor.lastSignature } : {}),
        limit: perAddrLimit,
      });
      if (sigs.length === 0) {
        // Nothing new — touch the cursor anyway so `last_run_at`
        // reflects this pass.
        await upsertCursor(db, {
          network,
          address: watch.address,
          kind: watch.kind,
          lastSignature: cursor?.lastSignature ?? null,
          lastSlot: cursor?.lastSlot ?? null,
          backfillComplete: cursor?.backfillComplete ?? false,
        });
        continue;
      }
      // Walk oldest-first so cursor advancement is monotonic and a
      // mid-pass crash leaves us in a valid resumable state.
      for (const sig of sigs.slice().reverse()) {
        result.signaturesFetched += 1;
        if (opts.perTxDelayMs && opts.perTxDelayMs > 0) {
          await sleep(opts.perTxDelayMs);
        }
        let tx;
        try {
          tx = await rpc.getTransaction({ network, signature: sig.signature });
        } catch (err) {
          result.errors += 1;
          log(`getTransaction failed sig=${sig.signature}: ${(err as Error).message}`);
          continue;
        }
        if (!tx) continue;
        const events = decodeTransaction(tx, {
          watchedAddress: watch.address,
          watchedKind: watch.kind as WatchKind,
          agentAsset: watch.agentAsset,
        });
        for (const ev of events) {
          const writeRes = await ingestChainEvent(db, {
            kind: ev.kind,
            network,
            signature: ev.signature,
            agentAsset: ev.agentAsset,
            mint: ev.mint,
            amountAtomic: ev.amountAtomic,
            metadata: { ...ev.metadata, watched_kind: watch.kind },
            blockTime: ev.blockTime,
            failed: tx.err != null,
          });
          if (!writeRes.duplicate) result.eventsWritten += 1;
        }
        // Advance cursor to this signature so the next tick starts after it.
        await upsertCursor(db, {
          network,
          address: watch.address,
          kind: watch.kind,
          lastSignature: sig.signature,
          lastSlot: sig.slot,
          backfillComplete: true,
        });
      }
    } catch (err) {
      result.errors += 1;
      log(`watch ${watch.address}/${watch.kind} failed: ${(err as Error).message}`);
    }
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
