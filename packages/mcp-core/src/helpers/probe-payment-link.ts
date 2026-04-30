/**
 * GET an x402 payment link and decode the `payment-required` header
 * into a typed preview the buyer-side artifact (or the MCP `pay`
 * implementation) can consume.
 *
 * The paywall always serves a single-network link, so we pick the
 * `accepts[]` entry whose network matches the URL's `?network=`
 * query (with a lenient fallback to `accepts[0]`).
 *
 * Throws on every error path so callers can wrap once and surface
 * the message verbatim to the model.
 */

import { decodeBase64Json } from './base64-json.js';

export type PaymentRequirementPreview = {
  network: string;
  pay_to: string;
  asset: string;
  amount_atomic: string;
  currency: string;
  description?: string;
};

export async function probePaymentLink(url: string): Promise<PaymentRequirementPreview> {
  const res = await fetch(url, { method: 'GET' });
  if (res.status !== 402) {
    throw new Error(`expected 402 from paywall, got HTTP ${res.status}`);
  }
  const header = res.headers.get('payment-required') ?? res.headers.get('PAYMENT-REQUIRED');
  if (!header) {
    throw new Error('seller did not send a `payment-required` header');
  }

  const decoded = decodeBase64Json(header) as {
    error?: string;
    accepts?: Array<{
      network?: string;
      payTo?: string;
      asset?: string;
      amount?: string;
      currency?: string;
      description?: string;
    }>;
  } | null;

  if (!decoded || !Array.isArray(decoded.accepts) || decoded.accepts.length === 0) {
    throw new Error(decoded?.error ?? 'malformed payment-required header');
  }

  const wantNetwork = (() => {
    try {
      const u = new URL(url);
      return u.searchParams.get('network') ?? null;
    } catch {
      return null;
    }
  })();

  const chosen =
    (wantNetwork
      ? decoded.accepts.find((a) =>
          (a.network ?? '')
            .toLowerCase()
            .includes(wantNetwork.replace('solana-', '').toLowerCase()),
        )
      : null) ?? decoded.accepts[0]!;

  if (!chosen.network || !chosen.payTo || !chosen.asset || !chosen.amount) {
    throw new Error('payment-required entry missing required fields');
  }

  const out: PaymentRequirementPreview = {
    network: chosen.network,
    pay_to: chosen.payTo,
    asset: chosen.asset,
    amount_atomic: chosen.amount,
    currency: chosen.currency ?? 'USDC',
  };
  if (chosen.description) out.description = chosen.description;
  return out;
}
