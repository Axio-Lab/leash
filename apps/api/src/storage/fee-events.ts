/**
 * Protocol-fee event helper.
 *
 * Whenever an earn `ReceiptV1` carrying a `price.fee` field is ingested
 * (push, pull, or paywall path), we emit a single `protocol.fee.collected`
 * event so the explorer's "Protocol fees" feed and any external webhook
 * subscriber can render it without re-parsing the raw receipt blob.
 *
 * The helper is idempotent on `receipt_hash` — `INSERT OR IGNORE`-style
 * dedup is enforced by checking for an existing event row with the same
 * `(network, kind, metadata.receipt_hash)` shape. This is intentionally
 * cheap (single SQL probe) because:
 *
 *   - Receipts ingest at multiple entry points (push, pull, paywall) and
 *     a buyer-kit retry can re-POST the same receipt; we should not
 *     emit a fee event twice.
 *   - The events table has no native uniqueness on (kind, metadata),
 *     so we synthesize one here rather than adding a migration.
 *
 * Failure mode: the helper *never* throws — emitting a fee event is
 * downstream of payment settlement and must not block the calling
 * route. Errors are logged via the optional `log` callback.
 */

import type { ReceiptV1 } from '@leash/schemas';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import { createPreparedEvent, markConfirmed, markSubmitted } from './events.js';
import type { SvmNetwork } from '../util/network.js';

export type EmitProtocolFeeArgs = {
  network: SvmNetwork;
  receipt: ReceiptV1;
  /**
   * Optional API key id to attribute the fee event to. Push ingest
   * carries one; the pull worker doesn't, so it stays null.
   */
  apiKeyId?: string | null;
  log?: (line: string) => void;
};

export type EmitProtocolFeeResult = {
  /** `null` when the receipt did not carry a fee (or already emitted). */
  eventId: string | null;
  /** True when an existing fee event was found for this receipt_hash. */
  duplicate: boolean;
};

/**
 * Inspect an ingested receipt and, if it represents a settled earn
 * call with a Leash protocol fee, emit a `protocol.fee.collected`
 * event row. Idempotent on `(network, receipt_hash)`.
 */
export async function emitProtocolFeeEvent(
  db: DbClient,
  args: EmitProtocolFeeArgs,
): Promise<EmitProtocolFeeResult> {
  const r = args.receipt;
  // Only earn-side receipts carry a fee — buyer-side spend receipts
  // describe the gross they paid but the seller is the one whose
  // revenue gets reduced, so the fee event lives on the earn path.
  // `decision === 'allow'` is the canonical "settled" outcome on
  // earn receipts; `deny` / `rejected` never reach a settled state
  // and therefore never produce a fee.
  if (r.kind !== 'earn') return { eventId: null, duplicate: false };
  if (r.decision !== 'allow') return { eventId: null, duplicate: false };
  const price = r.price;
  if (!price || !price.fee) return { eventId: null, duplicate: false };

  // Dedup probe: already emitted for this receipt_hash on this network?
  // Sub-string LIKE is acceptable here because `receipt_hash` is a
  // base16 / base58 token guaranteed to appear verbatim in the JSON.
  // Worst case (two receipts whose hashes are prefixes of each other)
  // is impossible by construction — receipt hashes are fixed-length.
  try {
    const probe = await execute(
      db,
      `SELECT id FROM events
         WHERE network = ?
           AND kind = 'protocol.fee.collected'
           AND metadata_json LIKE ?
         LIMIT 1`,
      [args.network, `%"receipt_hash":"${r.receipt_hash}"%`],
    );
    if (probe.rows.length > 0) {
      return { eventId: String(probe.rows[0]?.id), duplicate: true };
    }
  } catch (err) {
    args.log?.(`fee-event dedup probe failed: ${(err as Error).message}`);
  }

  const fee = price.fee;
  const gross = price.gross ?? null;
  const net = price.amount; // canonical seller leg = receipt.price.amount
  const feeBps = price.feeBps ?? null;
  const feeAuthority = price.feeAuthority ?? null;
  const currency = price.currency;
  const asset = price.asset ?? null;

  let eventId: string | null = null;
  try {
    eventId = await createPreparedEvent(db, {
      kind: 'protocol.fee.collected',
      network: args.network,
      apiKeyId: args.apiKeyId ?? null,
      agentAsset: r.agent,
      mint: asset,
      amountAtomic: fee,
      metadata: {
        receipt_hash: r.receipt_hash,
        currency,
        net_amount: net,
        ...(gross != null ? { gross_amount: gross } : {}),
        fee_amount: fee,
        ...(feeBps != null ? { fee_bps: feeBps } : {}),
        ...(feeAuthority ? { fee_authority: feeAuthority } : {}),
        ...(r.tx_sig ? { tx_sig: r.tx_sig } : {}),
      },
    });
    // Fee events are terminal — no on-chain confirmation to wait for.
    if (r.tx_sig) await markSubmitted(db, eventId, r.tx_sig);
    await markConfirmed(db, eventId);
  } catch (err) {
    args.log?.(`fee-event emit failed: ${(err as Error).message}`);
    return { eventId: null, duplicate: false };
  }
  return { eventId, duplicate: false };
}
