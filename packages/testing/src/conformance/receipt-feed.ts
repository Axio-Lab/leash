import { verifyReceiptChain } from '@leashmarket/core';

export type ConformanceResult =
  | { ok: true; count: number }
  | { ok: false; line: number; reason: string };

/** Validate JSONL feed: ReceiptV1 schema, gapless nonces, prev hash + receipt_hash chain (@leashmarket/core). */
export function validateReceiptFeed(text: string): ConformanceResult {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const v = verifyReceiptChain(lines);
  if (!v.ok) {
    return { ok: false, line: v.nonce + 1, reason: v.reason };
  }
  return { ok: true, count: v.count };
}
