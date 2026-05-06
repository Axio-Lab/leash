import type { ReceiptV1 } from '@leashmarket/schemas';
import { canonicalJson, sha256Hex } from './hash.js';

export type ReceiptDraft = Omit<ReceiptV1, 'receipt_hash'>;

export function computeReceiptHash(draft: ReceiptDraft): string {
  return sha256Hex(canonicalJson(draft));
}

export function finalizeReceipt(draft: ReceiptDraft): ReceiptV1 {
  const receipt_hash = computeReceiptHash(draft);
  return { ...draft, receipt_hash };
}
