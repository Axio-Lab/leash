/**
 * `X-Leash-*` HTTP header names and helpers.
 *
 * Sellers stamp these headers onto every successfully-settled response so
 * buyers (and proxies/observers) can read the payment envelope without
 * parsing the response body. Keep the names lowercase here — Hono / Next.js
 * normalise to lowercase, and the underlying x402 wire uses lowercase too.
 *
 * The set is exported as a single readonly map so consumers can:
 *   - reference the canonical name (`LEASH_HEADERS.txSig`)
 *   - generate the `Access-Control-Expose-Headers` value
 *   - parse without misspelling header names
 */

import type { LeashPaymentEnvelope } from './envelope.js';

export const LEASH_HEADERS = {
  txSig: 'x-leash-tx-sig',
  receiptHash: 'x-leash-receipt-hash',
  agent: 'x-leash-agent',
  txExplorer: 'x-leash-tx-explorer',
  agentExplorer: 'x-leash-agent-explorer',
} as const;

export type LeashHeaderName = (typeof LEASH_HEADERS)[keyof typeof LEASH_HEADERS];

/** All `X-Leash-*` headers as a single comma-separated list. */
export const LEASH_HEADERS_EXPOSE = Object.values(LEASH_HEADERS).join(', ');

/**
 * Header buyers (or middleware) can include on a request to opt into a
 * per-call webhook callback. The seller `/x/<id>` route fires this URL in
 * addition to the seller-configured `webhook_url`.
 */
export const LEASH_CALLBACK_HEADER = 'x-leash-callback';

/**
 * Mutate a `Headers` instance in place with the canonical `X-Leash-*` set
 * for a settled payment. Also appends to `Access-Control-Expose-Headers`
 * so cross-origin browser callers can read the values via `fetch`.
 */
export function buildLeashHeaders(envelope: LeashPaymentEnvelope, headers: Headers): Headers {
  headers.set(LEASH_HEADERS.txSig, envelope.tx_sig ?? '');
  headers.set(LEASH_HEADERS.receiptHash, envelope.receipt_hash);
  headers.set(LEASH_HEADERS.agent, envelope.agent);
  if (envelope.explorer.tx) headers.set(LEASH_HEADERS.txExplorer, envelope.explorer.tx);
  headers.set(LEASH_HEADERS.agentExplorer, envelope.explorer.agent);
  appendExposeHeaders(headers, LEASH_HEADERS_EXPOSE);
  return headers;
}

/** Result of {@link parseLeashHeaders} — narrow read of the wire envelope. */
export type ParsedLeashHeaders = {
  txSig: string | null;
  receiptHash: string | null;
  agent: string | null;
  txExplorer: string | null;
  agentExplorer: string | null;
};

/**
 * Read the `X-Leash-*` set off a `Response` (or any `Headers`-like). Empty
 * string values are normalised to `null` (the producer always emits all
 * keys, but uses empty strings when a settled tx_sig is missing).
 */
export function parseLeashHeaders(input: Headers | Response): ParsedLeashHeaders {
  const h = input instanceof Response ? input.headers : input;
  return {
    txSig: nonEmpty(h.get(LEASH_HEADERS.txSig)),
    receiptHash: nonEmpty(h.get(LEASH_HEADERS.receiptHash)),
    agent: nonEmpty(h.get(LEASH_HEADERS.agent)),
    txExplorer: nonEmpty(h.get(LEASH_HEADERS.txExplorer)),
    agentExplorer: nonEmpty(h.get(LEASH_HEADERS.agentExplorer)),
  };
}

function nonEmpty(s: string | null): string | null {
  if (s == null) return null;
  return s.length > 0 ? s : null;
}

function appendExposeHeaders(headers: Headers, value: string): void {
  const existing = headers.get('access-control-expose-headers');
  if (!existing) {
    headers.set('access-control-expose-headers', value);
    return;
  }
  // Avoid duplicating entries on repeated calls.
  const seen = new Set(existing.split(',').map((s) => s.trim().toLowerCase()));
  const additions = value.split(',').map((s) => s.trim());
  let dirty = false;
  for (const a of additions) {
    if (!seen.has(a.toLowerCase())) {
      seen.add(a.toLowerCase());
      dirty = true;
    }
  }
  if (dirty) {
    headers.set('access-control-expose-headers', [...seen].join(', '));
  }
}
