/**
 * Leash fee-ATA watchlist seeding.
 *
 * The protocol fee leg of every settled call lands in a deterministic
 * Associated Token Account: `ATA(<fee-authority>, <stable-mint>,
 * <token-program>)`. Per network we pre-derive the ATAs for every
 * known stable mint and insert them into `indexer_watchlist` with
 * `kind='leash_fee_ata'` so the indexer paginates `getSignaturesForAddress`
 * on each treasury ATA every tick. That gives us:
 *
 *   - Source-of-truth on-chain visibility for protocol revenue, even
 *     when a seller never POSTs receipts to `/v1/receipts/{agent}`.
 *   - A backstop for the receipt-side `protocol.fee.collected` event
 *     (which is best-effort): if a settled tx never produces a
 *     receipt push/pull, the chain decoder still emits the fee row.
 *
 * Idempotent and cheap — adds at most a handful of rows per network
 * per process boot. Safe to call from every cli startup; the
 * `INSERT OR IGNORE` guarantees no duplicate work.
 */

import { KNOWN_TOKENS, getLeashFeeAtaFor, resolveLeashFeeAuthority } from '@leash/core';

import type { DbClient } from '../storage/turso.js';
import type { SvmNetwork } from '../util/network.js';
import { ensureWatchedFeeAta } from './watchlist.js';

export type SeedFeeWatchlistResult = {
  network: SvmNetwork;
  feeAuthority: string;
  ataAddresses: string[];
};

/**
 * Derive every `(stable_mint, token_program)` ATA owned by the
 * configured Leash fee authority on the given network and add each
 * one to `indexer_watchlist` (idempotent). Returns the list of ATAs
 * for logging / `/v1/health` introspection.
 *
 * Networks map cleanly: API uses CAIP-2 (`solana-mainnet`) but the
 * `@leash/core` token registry uses the short form (`mainnet`). We
 * convert in a single place.
 */
export async function seedLeashFeeWatchlist(
  db: DbClient,
  network: SvmNetwork,
): Promise<SeedFeeWatchlistResult> {
  const tokenNetwork = network === 'solana-mainnet' ? 'mainnet' : 'devnet';
  const feeAuthority = resolveLeashFeeAuthority(tokenNetwork);
  const stables = KNOWN_TOKENS[tokenNetwork].filter((t) => t.stable);

  const ataAddresses: string[] = [];
  for (const t of stables) {
    const acct = await getLeashFeeAtaFor({
      network: tokenNetwork,
      asset: t.mint,
      tokenProgram: t.program,
      authority: feeAuthority,
    });
    const ataStr = String(acct.ata);
    await ensureWatchedFeeAta(db, {
      network,
      feeAuthority,
      ataAddress: ataStr,
    });
    ataAddresses.push(ataStr);
  }

  return { network, feeAuthority, ataAddresses };
}
