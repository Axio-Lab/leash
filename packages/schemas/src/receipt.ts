import { z } from 'zod';

const ReceiptKindSchema = z.enum(['spend', 'earn']);

const PriceSchema = z.object({
  amount: z.string(),
  currency: z.string(),
  network: z.string().optional(),
  asset: z.string().optional(),
  /**
   * Atomic Leash protocol fee charged on this settlement, base-10 string.
   * Optional + additive — receipts written before the fee rollout (and
   * settlements that bypass a Leash facilitator) leave this `null`.
   * When present, `gross = amount + fee`.
   */
  fee: z.string().nullable().optional(),
  /**
   * Atomic total the buyer signed on the wire (`amount + fee`). When
   * absent, callers should treat `amount` as both net and gross. Stored
   * separately so the explorer can render `gross / fee / net` without
   * re-doing arithmetic on every render.
   */
  gross: z.string().nullable().optional(),
  /**
   * Fee rate in basis points (e.g. `100` for 1%) the seller priced this
   * settlement at. Useful for the explorer when the global default
   * shifts so historical receipts continue to display the rate they
   * were actually charged.
   */
  feeBps: z.number().int().nullable().optional(),
  /**
   * Treasury authority pubkey that received the fee leg. Lets the
   * explorer link to the right account and lets the indexer attribute
   * `protocol.fee.collected` events to the right destination.
   */
  feeAuthority: z.string().nullable().optional(),
});

const RequestSummarySchema = z.object({
  method: z.string(),
  url: z.string(),
  body_hash: z.string().nullable(),
  headers_hash: z.string().nullable().optional(),
});

const ResponseSummarySchema = z
  .object({
    status: z.number().int(),
    body_hash: z.string().nullable().optional(),
  })
  .nullable();

/**
 * Facilitator identifier. We accept either a known short name (for
 * historical fixtures) or a full URL for any HTTPS x402 facilitator.
 * Real receipts SHOULD use the URL form so explorers can render a link.
 */
const FacilitatorSchema = z
  .union([z.enum(['payai', 'corbits', 'svmacc', 'self', 'local']), z.string().url()])
  .nullable();

export const ReceiptV1Schema = z.object({
  v: z.literal('0.1'),
  kind: ReceiptKindSchema.default('spend'),
  agent: z.string(),
  nonce: z.number().int().nonnegative(),
  ts: z.string(),
  policy_v: z.string(),
  request: RequestSummarySchema,
  /**
   * Outcome of the call:
   *  - `allow`    — policy gate passed AND (for spend receipts) payment settled.
   *  - `deny`     — policy gate denied the call before any payment was attempted.
   *  - `rejected` — policy gate allowed the call, but settlement failed
   *                 (insufficient balance, facilitator error, RPC outage, etc).
   *                 The `reason` field carries the failure cause.
   */
  decision: z.enum(['allow', 'deny', 'rejected']),
  reason: z.string().nullable(),
  price: PriceSchema.nullable(),
  facilitator: FacilitatorSchema,
  tx_sig: z.string().nullable(),
  /**
   * SHA-256 (hex) of the canonical `PaymentRequirements` object the buyer
   * paid against. Lets explorers cryptographically tie a `spend` receipt to
   * the `earn` receipt it settled, even when the seller uses dynamic pricing.
   * Optional for backwards compatibility with v0.0 fixtures.
   */
  payment_requirements_hash: z.string().nullable().optional(),
  response: ResponseSummarySchema,
  prev_receipt_hash: z.string().nullable(),
  receipt_hash: z.string(),
});

export type ReceiptV1 = z.infer<typeof ReceiptV1Schema>;

/** Shared body for v0.2 receipts (both x402 and MPP rails). */
const ReceiptV02CommonSchema = z.object({
  v: z.literal('0.2'),
  kind: ReceiptKindSchema.default('spend'),
  agent: z.string(),
  nonce: z.number().int().nonnegative(),
  ts: z.string(),
  policy_v: z.string(),
  request: RequestSummarySchema,
  decision: z.enum(['allow', 'deny', 'rejected']),
  reason: z.string().nullable(),
  price: PriceSchema.nullable(),
  facilitator: FacilitatorSchema,
  response: ResponseSummarySchema,
  prev_receipt_hash: z.string().nullable(),
  receipt_hash: z.string(),
});

export const ReceiptV02X402Schema = ReceiptV02CommonSchema.extend({
  protocol: z.literal('x402'),
  tx_sig: z.string().nullable(),
  payment_requirements_hash: z.string().nullable().optional(),
  /** Raw `PAYMENT-RESPONSE` header payload when captured. */
  payment_response: z.string().nullable().optional(),
});

export const ReceiptV02MppSchema = ReceiptV02CommonSchema.extend({
  protocol: z.literal('mpp'),
  mpp_challenge_id: z.string(),
  mpp_credential_type: z.literal('crypto'),
  /** Solana transaction signature that settled the MPP challenge. */
  mpp_settlement_tx: z.string(),
  mpp_settlement_slot: z.union([z.string(), z.number().int()]),
  /**
   * Optional mirror of `mpp_settlement_tx` for UIs that only read `tx_sig`.
   * When present, SHOULD equal `mpp_settlement_tx`.
   */
  tx_sig: z.string().nullable().optional(),
  payment_requirements_hash: z.string().nullable().optional(),
});

export const ReceiptV02Schema = z.discriminatedUnion('protocol', [
  ReceiptV02X402Schema,
  ReceiptV02MppSchema,
]);

export type ReceiptV02 = z.infer<typeof ReceiptV02Schema>;
export type ReceiptV02X402 = z.infer<typeof ReceiptV02X402Schema>;
export type ReceiptV02Mpp = z.infer<typeof ReceiptV02MppSchema>;

/** Any persisted receipt shape (v0.1 legacy or v0.2 dual-protocol). */
export type ReceiptAny = ReceiptV1 | ReceiptV02;

export function isReceiptV02(r: ReceiptAny): r is ReceiptV02 {
  return r.v === '0.2';
}

/**
 * Parse a receipt JSON object or string. Accepts `v: '0.1'` (legacy x402-only)
 * or `v: '0.2'` with `protocol: 'x402' | 'mpp'`.
 *
 * Does **not** rewrite v0.1 into v0.2 (that would invalidate `receipt_hash`).
 * Use {@link receiptProtocol} for a stable protocol label across versions.
 */
export function parseReceiptAny(json: unknown): ReceiptAny {
  const obj: unknown = typeof json === 'string' ? (JSON.parse(json) as unknown) : json;
  if (!obj || typeof obj !== 'object') {
    throw new Error('receipt: expected object');
  }
  const o = obj as Record<string, unknown>;
  if (o.v === '0.2') {
    return ReceiptV02Schema.parse(obj);
  }
  return ReceiptV1Schema.parse(obj);
}

/** Protocol label for UI / filters. v0.1 receipts are always x402-shaped. */
export function receiptProtocol(r: ReceiptAny): 'x402' | 'mpp' {
  if (isReceiptV02(r)) return r.protocol;
  return 'x402';
}
