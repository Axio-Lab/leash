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
