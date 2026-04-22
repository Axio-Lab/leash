/**
 * Leash webhook payload contract.
 *
 * After a successful payment the seller `/x/<id>` route POSTs a JSON body
 * shaped like {@link WebhookPayload} to:
 *   - the seller-configured `endpoint.webhook_url` (set when the link was
 *     created), and
 *   - any per-call `x-leash-callback` URL the buyer attached to the request.
 *
 * Webhook delivery is **fire-and-forget** — a slow or 5xx-returning
 * downstream never blocks the buyer's HTTP response. Downstream agents
 * receiving these payloads should treat them as ephemeral and idempotency-
 * key off `payment.receipt_hash`.
 */

import type { LeashPaymentEnvelope } from './envelope.js';

/** Payload posted to a webhook URL after a settled payment. */
export type WebhookPayload = {
  /** Stable schema version. Bump on breaking shape changes. */
  v: '0.1';
  /** Discriminator so downstream routers can reject other Leash events. */
  kind: 'leash.payment.settled';
  /** ISO-8601 timestamp of the post (server clock at delivery time). */
  ts: string;
  /** Compact payment summary — the same envelope stamped on `X-Leash-*` headers. */
  payment: LeashPaymentEnvelope;
  /**
   * The seller's response body, parsed as JSON when possible, otherwise the
   * raw text. `null` when the body was empty.
   */
  response: unknown;
};

export type BuildWebhookPayloadInput = {
  envelope: LeashPaymentEnvelope;
  /** Already-parsed response body. Pass the raw string for non-JSON responses. */
  response: unknown;
  /** Override the timestamp (e.g. for tests). */
  ts?: string;
};

/** Construct a typed {@link WebhookPayload} from an envelope + response body. */
export function buildWebhookPayload(input: BuildWebhookPayloadInput): WebhookPayload {
  return {
    v: '0.1',
    kind: 'leash.payment.settled',
    ts: input.ts ?? new Date().toISOString(),
    payment: input.envelope,
    response: input.response ?? null,
  };
}

/**
 * Parse and validate a payload received on the webhook endpoint side.
 *
 * Throws on shape mismatches so consumers can `try/catch` and reject the
 * delivery with a 4xx (which Leash will silently swallow — no retry today).
 */
export function parseWebhookPayload(input: unknown): WebhookPayload {
  if (!input || typeof input !== 'object') {
    throw new Error('webhook payload: body is not an object');
  }
  const obj = input as Record<string, unknown>;
  if (obj.v !== '0.1') {
    throw new Error(`webhook payload: unsupported version "${String(obj.v)}", expected "0.1"`);
  }
  if (obj.kind !== 'leash.payment.settled') {
    throw new Error(`webhook payload: unsupported kind "${String(obj.kind)}"`);
  }
  if (typeof obj.ts !== 'string' || obj.ts.length === 0) {
    throw new Error('webhook payload: ts must be a non-empty string');
  }
  if (!obj.payment || typeof obj.payment !== 'object') {
    throw new Error('webhook payload: payment must be an object');
  }
  const payment = parseEnvelope(obj.payment);
  return {
    v: '0.1',
    kind: 'leash.payment.settled',
    ts: obj.ts,
    payment,
    // Response is intentionally `unknown` — sellers can ship any shape.
    response: 'response' in obj ? (obj.response ?? null) : null,
  };
}

function parseEnvelope(raw: unknown): LeashPaymentEnvelope {
  const o = raw as Record<string, unknown>;
  if (typeof o.receipt_hash !== 'string' || o.receipt_hash.length === 0) {
    throw new Error('webhook payload: payment.receipt_hash must be a non-empty string');
  }
  if (typeof o.agent !== 'string' || o.agent.length === 0) {
    throw new Error('webhook payload: payment.agent must be a non-empty string');
  }
  const explorer = (o.explorer ?? {}) as Record<string, unknown>;
  return {
    tx_sig: typeof o.tx_sig === 'string' ? o.tx_sig : null,
    receipt_hash: o.receipt_hash,
    agent: o.agent,
    network: typeof o.network === 'string' ? o.network : null,
    amount: parseAmount(o.amount),
    facilitator: typeof o.facilitator === 'string' ? o.facilitator : null,
    explorer: {
      tx: typeof explorer.tx === 'string' ? explorer.tx : null,
      agent: typeof explorer.agent === 'string' ? explorer.agent : '',
    },
  };
}

function parseAmount(raw: unknown): LeashPaymentEnvelope['amount'] {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.amount !== 'string' || typeof o.currency !== 'string') return null;
  return { amount: o.amount, currency: o.currency };
}
