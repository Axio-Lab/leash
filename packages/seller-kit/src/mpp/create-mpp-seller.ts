/**
 * Hono middleware that turns a route into an MPP-protected resource.
 *
 * Mirrors the lifecycle of `createSeller` (x402) but speaks the MPP wire:
 *   - GET / POST without credential  → 402 with `application/problem+json`
 *     body carrying an `MppChallengeV1`. The challengeId is stored with
 *     a TTL (replay protection).
 *   - GET / POST with `Authorization: PaymentScheme <b64>` → decode
 *     credential, forward `(challenge, signedTx)` to the MPP facilitator,
 *     stamp `x-payment-receipt` on success, run the route handler, emit
 *     a `ReceiptV02X402`-shaped earn receipt with `protocol: 'mpp'`.
 *
 * The MPP path uses the same `payTo` PDA as x402 — sellers never need
 * a second on-chain identity for dual-protocol support.
 */

import type { Context as UmiContext } from '@metaplex-foundation/umi';
import type { Hono } from 'hono';
import {
  computeReceiptHash,
  MPP_AUTH_SCHEME,
  MPP_PROBLEM_TYPE,
  parseMppAuthorization,
  requestHash,
  type KnownStableSymbol,
  type TokenNetwork,
} from '@leashmarket/core';
import type { MppChallengeV1, ReceiptV02Mpp } from '@leashmarket/schemas';
import { ReceiptV02MppSchema } from '@leashmarket/schemas';

import { resolveSellerPayTo, type AgentSellerConfig } from '../seller/agent-seller.js';
import { parsePrice } from '../receipts/price.js';
import { caip2ForSellerNetwork, type LeashSellerNetwork } from '../x402/svm-server.js';
import {
  resolveSellerReceiptSink,
  type SellerReceiptForwardConfig,
} from '../hono/create-seller.js';
import {
  createInMemoryChallengeStore,
  type ChallengeStore,
  type ChallengeStoreOptions,
} from './challenge-store.js';
import { createMppFacilitatorClient, type MppFacilitatorClient } from './facilitator-client.js';

export type MppSellerRouteConfig = {
  description: string;
  /** Display price like x402 routes — `"0.001"`, `"$0.01"`, `"0.5 USDC"`. */
  price: string;
  /** Settlement currency. Defaults to `'USDC'`. */
  currency?: KnownStableSymbol;
  mimeType?: string;
};

export type CreateMppSellerOptions = {
  umi: Pick<UmiContext, 'eddsa' | 'programs'>;
  sellerAgent: AgentSellerConfig;
  routes: Record<string, MppSellerRouteConfig>;
  network?: LeashSellerNetwork;
  /**
   * MPP facilitator URL or pre-built client. Defaults to
   * `https://facilitator-devnet.leash.market` (which Phase 5 extends to
   * speak the `/mpp/settle` endpoint alongside the x402 routes).
   */
  facilitator?: string | MppFacilitatorClient;
  /**
   * Wallet that pays Solana fees + signs the idempotent ATA creates on
   * the buyer's signed transaction. Must match the address the buyer-kit
   * embedded as `request.feePayer` in the challenge — sellers stamp this
   * so the buyer can build a tx that the facilitator will co-sign.
   */
  feePayerAddress: string;
  challengeStore?: ChallengeStore;
  challengeStoreOptions?: ChallengeStoreOptions;
  onReceipt?: ((receipt: ReceiptV02Mpp) => void | Promise<void>) | false;
  receipts?: SellerReceiptForwardConfig;
  policyVersion?: string;
};

export type MppSeller = {
  payTo: string;
  facilitatorUrl: string;
  network: string;
};

type SellerState = {
  nonce: number;
  prevReceiptHash: string | null;
};

const DEFAULT_MPP_FACILITATOR_URL = 'https://facilitator-devnet.leash.market';

export function createMppSeller(app: Hono, opts: CreateMppSellerOptions): MppSeller {
  const payTo = resolveSellerPayTo(opts.umi, opts.sellerAgent);
  const agent = String(opts.sellerAgent.asset);
  const policyVersion = opts.policyVersion ?? '0.1';
  const sellerNetwork: LeashSellerNetwork = opts.network ?? 'solana-devnet';
  const networkCaip2 = caip2ForSellerNetwork(sellerNetwork);
  const tokenNetwork: TokenNetwork = sellerNetwork === 'solana-mainnet' ? 'mainnet' : 'devnet';
  const store = opts.challengeStore ?? createInMemoryChallengeStore(opts.challengeStoreOptions);
  const facilitator: MppFacilitatorClient =
    typeof opts.facilitator === 'string'
      ? createMppFacilitatorClient({ url: opts.facilitator })
      : (opts.facilitator ?? createMppFacilitatorClient({ url: DEFAULT_MPP_FACILITATOR_URL }));
  const state: SellerState = { nonce: 0, prevReceiptHash: null };
  const sink = resolveSellerReceiptSink<ReceiptV02Mpp>(opts.onReceipt, opts.receipts);

  for (const [routeKey, cfg] of Object.entries(opts.routes)) {
    const [methodRaw, path] = routeKey.split(/\s+/, 2);
    if (!methodRaw || !path) {
      throw new Error(`Invalid route key: ${routeKey}`);
    }
    const method = methodRaw.toUpperCase();
    const parsedPrice = parsePrice(cfg.price, {
      network: tokenNetwork,
      defaultCurrency: cfg.currency ?? 'USDC',
    });
    if (!parsedPrice || !parsedPrice.asset) {
      throw new Error(`Invalid price "${cfg.price}" for ${cfg.currency ?? 'USDC'}`);
    }

    app.on(method, path, async (c, next) => {
      const auth = c.req.header('authorization') ?? c.req.header('Authorization') ?? null;
      // No credential → issue a fresh challenge.
      if (!auth || !auth.toLowerCase().startsWith(`${MPP_AUTH_SCHEME.toLowerCase()} `)) {
        return issueChallenge({
          routeKey: `${method} ${path}`,
          description: cfg.description,
          price: parsedPrice,
          payTo,
          /** Friendly slug (`solana-devnet`) — matches buyer-kit `networks[]` checks. */
          networkSlug: sellerNetwork,
          feePayerAddress: opts.feePayerAddress,
          store,
        });
      }

      // Credential present → decode, look up challenge, forward to facilitator.
      let credential;
      try {
        credential = parseMppAuthorization(auth);
        if (!credential) throw new Error('missing credential');
      } catch (e) {
        return c.json({ error: `mpp_credential_invalid: ${(e as Error).message}` }, 400);
      }
      const stored = store.get(credential.challengeId);
      if (!stored) {
        return c.json({ error: 'mpp_challenge_unknown_or_expired' }, 402);
      }
      if (stored.consumed) {
        return c.json({ error: 'mpp_challenge_already_consumed' }, 402);
      }
      const settle = await facilitator.settle({
        challenge: stored.challenge,
        signedTx: credential.signedTx,
      });
      if (!settle.success) {
        return c.json({ error: settle.error }, 402);
      }
      // Mark as consumed only after the facilitator confirms.
      store.consume(credential.challengeId);

      // Run the actual route handler. Hono dispatches the next matching
      // handler; we mounted on the same `(method, path)` tuple so the user's
      // GET/POST route fires next. Hono allows multiple handlers on the
      // same key — they run in registration order.
      await next();

      // Stamp the settlement header on the actual response. We deliberately
      // do this AFTER `next()` rather than before: when the inner route
      // handler returns a fresh `new Response(...)`, Hono's response setter
      // does NOT merge headers previously set via `c.header(...)` (those
      // live on the internal `#preparedHeaders` and are dropped when the
      // raw Response replaces `c.res`). Setting AFTER `next()` mutates the
      // actual response's headers directly, which buyer-kit reads to learn
      // the settlement tx + slot.
      c.header('x-payment-receipt', b64Json({ tx: settle.transaction, slot: settle.slot }));

      // Emit the earn receipt after the handler runs so we can capture
      // the actual response status. Errors here are swallowed by the sink.
      const responseStatus = c.res.status;
      const receipt = buildMppEarnReceipt({
        agent,
        nonce: state.nonce,
        prevReceiptHash: state.prevReceiptHash,
        policyVersion,
        method,
        url: c.req.url,
        responseStatus,
        challenge: stored.challenge,
        settlement: { transaction: settle.transaction, slot: settle.slot },
        facilitator: facilitator.url,
      });
      state.nonce += 1;
      state.prevReceiptHash = receipt.receipt_hash;
      try {
        await sink(receipt);
      } catch {
        /* swallow — receipt forward errors must not break the buyer call */
      }
    });
  }

  return { payTo, facilitatorUrl: facilitator.url, network: networkCaip2 };
}

function issueChallenge(args: {
  routeKey: string;
  description: string;
  price: { amount: string; currency: string; asset?: string | null };
  payTo: string;
  /** `solana-devnet` / `solana-mainnet` / `solana-testnet` — wire field for buyers. */
  networkSlug: LeashSellerNetwork;
  feePayerAddress: string;
  store: ChallengeStore;
}) {
  const challengeId = generateChallengeId();
  const challenge: MppChallengeV1 = {
    type: MPP_PROBLEM_TYPE,
    title: 'Payment Required',
    status: 402,
    detail: args.description,
    challengeId,
    request: {
      recipient: args.payTo,
      amount: args.price.amount,
      currency: args.price.currency,
      network: args.networkSlug,
      asset: args.price.asset!,
      feePayer: args.feePayerAddress,
    },
  };
  args.store.put(challengeId, {
    challenge,
    routeKey: args.routeKey,
    issuedAt: Date.now(),
    consumed: false,
  });
  return new Response(JSON.stringify(challenge), {
    status: 402,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/**
 * Generate a uniqueish challenge id. Prefers `crypto.randomUUID()` (Node
 * 19+, all browsers) and falls back to a 16-byte random hex string —
 * both are >= 122 bits of entropy, plenty for replay protection inside
 * the seller's TTL window.
 */
function generateChallengeId(): string {
  const c = (
    globalThis as {
      crypto?: { randomUUID?: () => string; getRandomValues?: (buf: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Cryptographically weak fallback (only Node <19 with no webcrypto).
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function b64Json(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof btoa === 'function') return btoa(json);
  return Buffer.from(json, 'utf8').toString('base64');
}

function buildMppEarnReceipt(args: {
  agent: string;
  nonce: number;
  prevReceiptHash: string | null;
  policyVersion: string;
  method: string;
  url: string;
  responseStatus: number;
  challenge: MppChallengeV1;
  settlement: { transaction: string; slot: string | number };
  facilitator: string;
}): ReceiptV02Mpp {
  const draft = {
    v: '0.2' as const,
    protocol: 'mpp' as const,
    kind: 'earn' as const,
    agent: args.agent,
    nonce: args.nonce,
    ts: new Date().toISOString(),
    policy_v: args.policyVersion,
    request: {
      method: args.method,
      url: args.url,
      body_hash: requestHash({ method: args.method, url: args.url, body: null }),
    },
    decision: 'allow' as const,
    reason: null,
    price: {
      amount: args.challenge.request.amount,
      currency: args.challenge.request.currency,
      network: args.challenge.request.network,
      asset: args.challenge.request.asset,
    },
    facilitator: args.facilitator,
    response: { status: args.responseStatus, body_hash: null },
    prev_receipt_hash: args.prevReceiptHash,
    mpp_challenge_id: args.challenge.challengeId,
    mpp_credential_type: 'crypto' as const,
    mpp_settlement_tx: args.settlement.transaction,
    mpp_settlement_slot: args.settlement.slot,
    tx_sig: args.settlement.transaction,
  } satisfies Omit<ReceiptV02Mpp, 'receipt_hash'>;
  const receipt_hash = computeReceiptHash(draft);
  return ReceiptV02MppSchema.parse({ ...draft, receipt_hash });
}
