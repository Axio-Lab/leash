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
import {
  ensureWatchedAta,
  getCursor,
  listWatchlist,
  upsertCursor,
  type WatchKind,
  type WatchRow,
} from './watchlist.js';

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
  /**
   * Optional ATA-discovery hook: given a treasury PDA, returns the
   * pubkeys of the SPL token accounts it owns (across both classic
   * Token and Token-2022 programs). Used at most once per agent per
   * process — `discoveredAgents` below caches the result so we don't
   * spam the RPC. When omitted, ATA discovery is skipped (the API
   * still adds ATAs to the watchlist via prepare/balances routes).
   */
  discoverTreasuryAtas?: (args: {
    network: SvmNetwork;
    treasuryAddress: string;
  }) => Promise<string[]>;
};

export type IndexerTickResult = {
  network: SvmNetwork;
  addressesScanned: number;
  signaturesFetched: number;
  eventsWritten: number;
  errors: number;
};

/**
 * Per-process cache of agents we've already discovered ATAs for. We
 * scan an agent's treasury exactly once per indexer process to keep
 * RPC pressure low — subsequent tick passes rely on the watchlist
 * rows the API + this discovery loop already wrote. Restarting the
 * indexer re-discovers, which is correct behaviour for picking up
 * ATAs created out-of-band (e.g. a new stable mint).
 */
const discoveredAgents = new Set<string>();

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

  // Build agent → treasury PDA map once per tick. The decoder needs
  // this when processing `treasury_ata` rows: the ATA's owner (the
  // PDA) is what `tokenBalanceDeltas` is keyed by, but the watch row
  // only carries the ATA address.
  const treasuryByAgent = buildTreasuryMap(watchlist);

  // Lazy ATA discovery — fan out once per agent we haven't seen
  // before. Adds rows to the watchlist in-place; they'll be picked up
  // on the next iteration of this same loop because we re-list below.
  if (opts.discoverTreasuryAtas) {
    for (const [agent, treasury] of treasuryByAgent.entries()) {
      const cacheKey = `${network}|${agent}`;
      if (discoveredAgents.has(cacheKey)) continue;
      discoveredAgents.add(cacheKey);
      try {
        const atas = await opts.discoverTreasuryAtas({
          network,
          treasuryAddress: treasury,
        });
        for (const ata of atas) {
          await ensureWatchedAta(db, { network, agentAsset: agent, ataAddress: ata });
        }
        if (atas.length > 0) {
          log(`discovered ${atas.length} treasury ATA(s) for agent=${agent}`);
        }
      } catch (err) {
        // Non-fatal: deposits will still go undetected this tick, but
        // we'll re-attempt next process restart.
        log(`treasury ATA discovery failed agent=${agent}: ${(err as Error).message}`);
      }
    }
  }

  // Re-list so the freshly added ATA watch rows participate in this
  // tick instead of waiting another 15s.
  const finalWatchlist =
    opts.discoverTreasuryAtas && treasuryByAgent.size > 0
      ? await listWatchlist(db, network)
      : watchlist;

  for (const watch of finalWatchlist) {
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
        const treasuryForAgent = treasuryByAgent.get(watch.agentAsset);
        const events = decodeTransaction(tx, {
          watchedAddress: watch.address,
          watchedKind: watch.kind as WatchKind,
          agentAsset: watch.agentAsset,
          ...(treasuryForAgent ? { treasuryAddress: treasuryForAgent } : {}),
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

/** Reset the per-process discovery cache. Used by tests. */
export function _resetDiscoveryCacheForTests(): void {
  discoveredAgents.clear();
}

function buildTreasuryMap(rows: WatchRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.kind === 'treasury') out.set(r.agentAsset, r.address);
  }
  return out;
}
