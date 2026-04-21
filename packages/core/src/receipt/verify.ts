import { ReceiptV1Schema } from '@leash/schemas';
import { computeReceiptHash } from './build.js';

export type VerifyResult =
  | { ok: true; count: number }
  | { ok: false; nonce: number; reason: string };

export function verifyReceiptChain(lines: string[]): VerifyResult {
  let prev: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return { ok: false, nonce: i, reason: 'invalid_json' };
    }
    const r = ReceiptV1Schema.safeParse(parsed);
    if (!r.success) {
      return { ok: false, nonce: i, reason: 'invalid_schema' };
    }
    const rec = r.data;
    if (rec.nonce !== i) {
      return { ok: false, nonce: i, reason: 'nonce_mismatch' };
    }
    if (rec.prev_receipt_hash !== prev) {
      return { ok: false, nonce: i, reason: 'prev_hash_mismatch' };
    }
    const { receipt_hash, ...rest } = rec;
    const expected = computeReceiptHash(rest);
    if (receipt_hash !== expected) {
      return { ok: false, nonce: i, reason: 'receipt_hash_mismatch' };
    }
    prev = rec.receipt_hash;
  }
  return { ok: true, count: lines.filter((l) => l.trim()).length };
}
