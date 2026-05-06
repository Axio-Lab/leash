/**
 * GET a Leash paywall URL and classify it as **x402** (payment-required
 * header) or **MPP** (problem+json body) using the same rules as
 * `@leashmarket/core` {@link detectProtocol}.
 *
 * Returns a `PaymentRequirementPreview` the buyer artifact (or MCP
 * `pay`) can consume. Throws on non-402 responses and unrecognised 402s.
 */

import { detectProtocol } from '@leashmarket/core';
import { decodeBase64Json } from './base64-json.js';
import { symbolForMintSafe } from './token-catalog.js';

export type PaymentRequirementPreview = {
  protocol: 'x402' | 'mpp';
  network: string;
  pay_to: string;
  asset: string;
  amount_atomic: string;
  currency: string;
  description?: string;
  /** Present when `protocol === 'mpp'`. */
  challenge_id?: string;
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
  const det = await detectProtocol(res);

  if (det.protocol === 'none') {
    throw new Error(`expected 402 from paywall, got HTTP ${det.status}`);
  }
  if (det.protocol === 'unknown') {
    throw new Error(`paywall response is neither x402 nor MPP: ${det.detail}`);
  }

  if (det.protocol === 'mpp') {
    const ch = det.challenge;
    const fromRegistry = symbolForMintAnyNetwork(ch.request.asset);
    const currency = ch.request.currency ?? fromRegistry ?? 'USDC';
    const out: PaymentRequirementPreview = {
      protocol: 'mpp',
      network: ch.request.network,
      pay_to: ch.request.recipient,
      asset: ch.request.asset,
      amount_atomic: ch.request.amount,
      currency,
      challenge_id: ch.challengeId,
    };
    if (ch.detail) out.description = ch.detail;
    return out;
  }

  const header = det.paymentRequiredHeader;
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

  const fromRegistry = symbolForMintAnyNetwork(chosen.asset);
  const currency = chosen.currency ?? fromRegistry ?? 'USDC';

  const out: PaymentRequirementPreview = {
    protocol: 'x402',
    network: chosen.network,
    pay_to: chosen.payTo,
    asset: chosen.asset,
    amount_atomic: chosen.amount,
    currency,
  };
  if (chosen.description) out.description = chosen.description;
  return out;
}
