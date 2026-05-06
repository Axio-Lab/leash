/**
 * `EndpointV1` — a Leash payment-link descriptor.
 *
 * An endpoint is the "Stripe Payment Link for x402" record: an agent owner
 * declares (`HTTP method` + `path` + `price`), and any x402-aware caller
 * can dial `https://<host>/x/<id>` to either probe the offer (returns 402
 * with a real `paymentRequirements[]`) or pay it (returns the configured
 * response template).
 *
 * Endpoints are stored on the runner (server-side) so the shareable URL is
 * resolvable from anywhere — not just the device that created it.
 *
 * The receiving Asset Signer PDA is derived at request time from
 * `owner_agent` (the Core asset mint), so the publisher never has to hold
 * a separate "payTo" key. Payments settle into the agent's treasury PDA
 * exactly as if a hand-rolled `createSeller` call had been used.
 */

import { z } from 'zod';

export const EndpointMethodSchema = z.enum(['GET', 'POST']);
export type EndpointMethod = z.infer<typeof EndpointMethodSchema>;

/** Stable URL-safe identifier (8–32 chars, lowercase alphanumerics + `-`). */
export const EndpointIdSchema = z
  .string()
  .min(4)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase alphanumerics and dashes only');

/** Response body returned after a successful x402 settlement. */
const ResponseTemplateSchema = z.object({
  status: z.number().int().min(100).max(599).default(200),
  /** MIME type. Defaults to `application/json`. */
  mimeType: z.string().default('application/json'),
  /** Body to return verbatim. Strings are sent as-is; objects are JSON-encoded. */
  body: z.union([z.string(), z.record(z.unknown())]),
});
export type EndpointResponseTemplate = z.infer<typeof ResponseTemplateSchema>;

/** Loose URL guard so the runner doesn't accept obvious garbage. */
const HttpUrlSchema = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'must be http:// or https://' });

export const EndpointV1Schema = z.object({
  v: z.literal('0.1'),
  /** URL-safe slug — what shows up in `https://host/x/<id>`. */
  id: EndpointIdSchema,
  /** Human label shown in the payment-link list / explorer. */
  label: z.string().min(1).max(120),
  /** Optional longer description rendered on the public paywall. */
  description: z.string().max(500).optional(),
  /** Core asset mint of the agent that earns payments through this endpoint. */
  owner_agent: z.string().min(32),
  /** Connected wallet that created the endpoint (asset owner at creation time). */
  owner_wallet: z.string().min(32).optional(),
  /** HTTP method clients must use. */
  method: EndpointMethodSchema,
  /**
   * Display price string, parsed by `@leashmarket/seller-kit`'s `parsePrice`.
   * Examples: `"$0.001"`, `"0.01 USDC"`, `"0.5"`. Denominated in `currency`
   * (defaults to `'USDC'`).
   */
  price: z.string().min(1),
  /** CAIP-2 network the seller settles on. Defaults to `'solana-devnet'`. */
  network: z.enum(['solana-mainnet', 'solana-devnet', 'solana-testnet']).default('solana-devnet'),
  /**
   * Primary settlement currency. Must be a Leash-known stablecoin so the
   * runner can resolve a real SPL mint via `@leashmarket/core/tokens`. Defaults
   * to `'USDC'` for backwards compatibility with pre-multi-currency links.
   */
  currency: z.enum(['USDC', 'USDT', 'USDG']).default('USDC'),
  /**
   * Additional stablecoins this endpoint also accepts. The runner advertises
   * an x402 `accepts[]` of equivalent payment options at the same dollar
   * amount across each stable, so paying agents can choose any. The primary
   * `currency` is always implicitly accepted.
   */
  accepts_currencies: z
    .array(z.enum(['USDC', 'USDT', 'USDG']))
    .max(3)
    .default([]),
  /** Returned verbatim after a successful settlement. */
  response: ResponseTemplateSchema,
  /**
   * Optional fire-and-forget webhook. When set, after a successful
   * settlement the runner POSTs `{ payment, response }` to this URL in
   * the background. Use to hand the paid response to a downstream agent
   * without making the buyer poll. The buyer can override per-call by
   * sending an `x-leash-callback: <url>` header.
   */
  webhook_url: HttpUrlSchema.optional(),
  /**
   * If `true`, JSON responses are wrapped as
   * `{ data: <user-body>, _leash: { tx_sig, receipt_hash, agent, explorer } }`
   * so paying agents have everything they need in one payload. Defaults
   * to `false` (preserves arbitrary response contracts). Honoured for
   * `application/json` responses; ignored for non-JSON / string bodies.
   */
  wrap_receipt: z.boolean().default(false),
  created_at: z.string(),
  updated_at: z.string(),
});

export type EndpointV1 = z.infer<typeof EndpointV1Schema>;

/** Input shape accepted by `runner.POST /endpoints` — server fills in timestamps. */
export const EndpointCreateInputSchema = EndpointV1Schema.omit({
  v: true,
  created_at: true,
  updated_at: true,
}).extend({
  /** Optional — runner will generate a slug if omitted. */
  id: EndpointIdSchema.optional(),
});

/**
 * Use {@link z.input} (not `z.infer` / `z.output`) so callers can omit
 * fields that have a Zod `.default(...)` (e.g. `currency`,
 * `accepts_currencies`, `network`, `wrap_receipt`). The runner backfills
 * them via `EndpointCreateInputSchema.parse(...)` before persisting.
 */
export type EndpointCreateInput = z.input<typeof EndpointCreateInputSchema>;
