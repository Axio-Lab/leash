#!/usr/bin/env node
/**
 * Standalone indexer worker.
 *
 * Polls both networks (`solana-devnet`, `solana-mainnet`) on a fixed
 * cadence, runs the chain indexer pass and the receipt-pull pass, and
 * logs a one-line summary per network per tick.
 *
 * Usage:
 *   pnpm -F @leashmarket/api indexer
 *
 * Env (all optional, sensible defaults):
 *   LEASH_API_DB_URL              - libsql url, defaults to file:./.leash-api.db
 *   LEASH_API_RPC_DEVNET          - devnet RPC URL (defaults to public)
 *   LEASH_API_RPC_MAINNET         - mainnet RPC URL (defaults to public)
 *   LEASH_INDEXER_INTERVAL_MS     - tick interval, default 15s
 *   LEASH_INDEXER_PER_ADDR_LIMIT  - signatures per address per tick (default 200)
 *   LEASH_INDEXER_DISABLE_DEVNET  - set to "1" to skip devnet
 *   LEASH_INDEXER_DISABLE_MAINNET - set to "1" to skip mainnet
 *   LEASH_INDEXER_DISABLE_PULL    - set to "1" to skip receipt-pull worker
 */

import { createConfig } from '../config.js';
import { getDb, runMigrations } from '../storage/turso.js';
import { SVM_NETWORKS, type SvmNetwork } from '../util/network.js';
import { createRpcClient } from './rpc.js';
import { runIndexerTick } from './run.js';
import { runReceiptPullTick } from './receipt-pull.js';
import { discoverTreasuryAtas } from './ata-discovery.js';
import { seedLeashFeeWatchlist } from './leash-fee-watchlist.js';

async function main(): Promise<void> {
  const config = createConfig();
  const db = getDb(config);
  await runMigrations(db);

  const rpc = createRpcClient({ rpcUrls: config.rpc });
  const intervalMs = Number(process.env.LEASH_INDEXER_INTERVAL_MS ?? 15_000);
  const perAddrLimit = Number(process.env.LEASH_INDEXER_PER_ADDR_LIMIT ?? 200);
  const disabledNetworks = new Set<SvmNetwork>();
  if (process.env.LEASH_INDEXER_DISABLE_DEVNET === '1') disabledNetworks.add('solana-devnet');
  if (process.env.LEASH_INDEXER_DISABLE_MAINNET === '1') disabledNetworks.add('solana-mainnet');
  const pullDisabled = process.env.LEASH_INDEXER_DISABLE_PULL === '1';

  const enabled = SVM_NETWORKS.filter((n) => !disabledNetworks.has(n));
  console.log(
    `[indexer] starting; networks=[${enabled.join(',')}] interval=${intervalMs}ms perAddrLimit=${perAddrLimit} pull=${!pullDisabled}`,
  );

  // Seed Leash protocol-fee ATAs into the watchlist once at boot so the
  // first tick already includes them. Idempotent — safe to repeat on
  // every restart. Failures are non-fatal: revenue tracking just stays
  // receipts-only (which is best-effort) until we restart.
  for (const network of enabled) {
    try {
      const seeded = await seedLeashFeeWatchlist(db, network);
      console.log(
        `[indexer] seeded ${seeded.ataAddresses.length} fee ATA(s) for ${network} authority=${seeded.feeAuthority}`,
      );
    } catch (err) {
      console.error(`[indexer] fee-ata seed failed (${network}): ${(err as Error).message}`);
    }
  }

  let stopped = false;
  const stop = () => {
    stopped = true;
    console.log('[indexer] stop signal received, draining…');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopped) {
    const tickStart = Date.now();
    for (const network of enabled) {
      try {
        const r = await runIndexerTick({
          db,
          rpc,
          network,
          options: {
            perAddressLimit: perAddrLimit,
            discoverTreasuryAtas: ({ network: n, treasuryAddress }) =>
              discoverTreasuryAtas({ rpcUrl: config.rpc[n]!, treasuryAddress }),
          },
        });
        console.log(
          `[indexer] ${network} addrs=${r.addressesScanned} sigs=${r.signaturesFetched} events=${r.eventsWritten} errors=${r.errors}`,
        );
      } catch (err) {
        console.error(`[indexer] ${network} tick failed: ${(err as Error).message}`);
      }
      if (!pullDisabled) {
        try {
          const p = await runReceiptPullTick({ db, network });
          console.log(
            `[receipt-pull] ${network} targets=${p.targetsScanned} ingested=${p.receiptsIngested} dup=${p.receiptsDuplicate} errors=${p.errors}`,
          );
        } catch (err) {
          console.error(`[receipt-pull] ${network} tick failed: ${(err as Error).message}`);
        }
      }
    }
    const elapsed = Date.now() - tickStart;
    const wait = Math.max(intervalMs - elapsed, 1_000);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  console.log('[indexer] exited cleanly');
}

main().catch((err) => {
  console.error('[indexer] fatal:', err);
  process.exit(1);
});
