/**
 * Hashing + canonical wire envelope for MPP receipts.
 *
 * MPP receipts (v0.2 mpp variant in `@leashmarket/schemas`) hash the
 * same way x402 receipts do: SHA-256 of the canonical JSON of the
 * draft (everything except `receipt_hash`). The `protocol` discriminator
 * is part of the canonical body so x402 and MPP receipts in the same
 * agent's chain can never collide on hash.
 *
 * This file also exports a thin helper to canonicalise an MPP challenge
 * for replay-protection bookkeeping (sellers track issued challengeIds
 * to reject reuse; the canonical form gives a stable id-by-content).
 */

import type { MppChallengeV1 } from '@leashmarket/schemas';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { canonicalJson } from '../receipt/hash.js';

/**
 * Stable hash of a challenge — useful when persisting issued challenges
 * to reject replays without storing the full body.
 */
export function mppChallengeHash(challenge: MppChallengeV1): string {
  const canonical = canonicalJson(challenge);
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}

/**
 * Compact wire summary of a settled MPP payment, mirroring
 * {@link LeashPaymentEnvelope} for x402. Sellers stamp this on response
 * headers / webhooks so downstream consumers can render proofs without
 * reading the full receipt.
 */
export type MppPaymentEnvelope = {
  protocol: 'mpp';
  challengeId: string;
  /** Solana SPL transfer signature that satisfied the challenge. */
  settlementTx: string;
  settlementSlot: string | number;
  /** SHA-256 of the canonical receipt — useful as an idempotency key. */
  receiptHash: string;
  /** Mint address of the agent that earned the payment. */
  agent: string;
  network: string | null;
};
