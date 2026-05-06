import type { ReceiptV1 } from '@leashmarket/schemas';
import { canonicalJson, sha256Hex } from './hash.js';

export type ReceiptDraft = Omit<ReceiptV1, 'receipt_hash'>;

/**
 * SHA-256 (hex) of the canonical JSON form of a receipt draft. Generic so
 * v0.2 receipts (x402 + mpp variants) can be hashed without copy-pasting
 * the implementation. The wire shape is identical — keys are sorted and
 * `receipt_hash` itself is excluded from the input.
 */
export function computeReceiptHash<T extends object>(draft: T): string {
  return sha256Hex(canonicalJson(draft));
}

export function finalizeReceipt(draft: ReceiptDraft): ReceiptV1 {
  const receipt_hash = computeReceiptHash(draft);
  return { ...draft, receipt_hash };
}
