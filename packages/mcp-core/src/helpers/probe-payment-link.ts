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
import { symbolForMintSafe } from './token-catalog.js';

export type PaymentRequirementPreview = {
  network: string;
  pay_to: string;
  asset: string;
  amount_atomic: string;
  currency: string;
  description?: string;
};

/**
 * Reverse-lookup a ticker by mint trying *both* network buckets. The
 * x402 envelope's `network` field is often a CAIP-2 chain reference
 * like `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (the genesis hash of
 * Solana devnet), not the friendly `solana-devnet` slug — so a literal
 * `/devnet/i` heuristic misses every CAIP-2 quote. Stable mints are
 * disjoint across mainnet/devnet so this is safe.
 */
function symbolForMintAnyNetwork(mint: string): string | null {
  return symbolForMintSafe(mint, 'devnet') ?? symbolForMintSafe(mint, 'mainnet') ?? null;
}

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

  // Currency resolution order:
  //   1. explicit `currency` on the chosen accept (extension surface;
  //      vanilla x402 envelopes don't carry it, but we look anyway),
  //   2. catalog reverse-lookup keyed by the asset mint (covers every
  //      Leash-self-hosted x402 link since the API shapes 402 quotes
  //      from the catalogued USDC/USDG/USDT mint),
  //   3. last-resort 'USDC' so the model never sees an empty ticker.
  // The previous unconditional `?? 'USDC'` mis-labelled USDG/USDT links
  // and caused buyer-kit to ask for the wrong asset → `preferred_asset_unavailable`.
  const fromRegistry = symbolForMintAnyNetwork(chosen.asset);
  const currency = chosen.currency ?? fromRegistry ?? 'USDC';

  const out: PaymentRequirementPreview = {
    network: chosen.network,
    pay_to: chosen.payTo,
    asset: chosen.asset,
    amount_atomic: chosen.amount,
    currency,
  };
  if (chosen.description) out.description = chosen.description;
  return out;
}
