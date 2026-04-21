/**
 * Re-exports of x402 protocol types so consumers don't have to depend on
 * `@x402/core` directly. The actual parsing of `paymentRequirements` lives
 * inside `@x402/fetch`'s `wrapFetchWithPayment` (buyer) and `@x402/hono`'s
 * `paymentMiddleware` (seller); we keep this module purely as a typed surface.
 */
export type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
} from '@x402/core/types';

export { decodePaymentResponseHeader } from '@x402/core/http';

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { PaymentRequirements } from '@x402/core/types';

/**
 * SHA-256 (hex) of the canonical JSON form of a `PaymentRequirements` object.
 * Used as the `payment_requirements_hash` field on `ReceiptV1` so a `spend`
 * receipt is cryptographically tied to the offer it paid against.
 *
 * Keys are sorted lexicographically before hashing to make the digest stable
 * across producers. Returns `null` for null/undefined input so callers can
 * pass `requirements ?? null` without branching.
 */
export function paymentRequirementsHash(
  requirements: PaymentRequirements | null | undefined,
): string | null {
  if (requirements == null) return null;
  const canonical = canonicalize(requirements);
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}
