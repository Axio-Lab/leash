/**
 * Buyer-kit endpoints — full HTTP parity with `@leash/buyer-kit`.
 *
 * The buyer-kit is the only piece of Leash that holds a private key
 * (the buyer's signing wallet), so we cannot literally hoist the whole
 * `Buyer.fetch()` flow into a single API call. Instead we expose every
 * intermediate primitive, mirroring the same prepare/sign/submit split
 * the registry-utils API already uses for on-chain ops:
 *
 *   - `POST /v1/buyer/quote`              – fetch a URL with no payment,
 *     decode the seller's `payment-required` 402 header, return the
 *     parsed `paymentRequirements` + a network-aware "chosen" pick.
 *   - `POST /v1/buyer/policy/evaluate`    – pure RulesV1 gate (no IO).
 *   - `POST /v1/buyer/payment/prepare`    – build an unsigned SPL
 *     `TransferChecked` from buyer ATA → seller payTo ATA. Caller signs
 *     locally and either submits via `/v1/submit` or wraps it into the
 *     `X-PAYMENT` header for `/v1/buyer/payment/execute`.
 *   - `POST /v1/buyer/payment/execute`    – server-side proxy that
 *     replays the seller request with a buyer-supplied `X-PAYMENT`
 *     header, parses `PAYMENT-RESPONSE`, builds + ingests the spend
 *     receipt, and returns the response summary.
 *   - `POST /v1/buyer/receipt/finalize`   – compute `receipt_hash` from
 *     a draft (pure).
 *   - `POST /v1/buyer/receipt/verify`     – run `verifyReceiptChain`
 *     over a JSONL chain or array of `ReceiptV1` (pure).
 *   - `GET  /v1/buyer/networks`           – buyer-side network catalog
 *     (network slug, CAIP-2, default facilitator, accepted stables).
 *   - `GET  /v1/buyer/currency`           – stablecoins the buyer can
 *     pay in on the caller-scoped network.
 *
 * Every endpoint is network-scoped via the API key prefix, just like
 * the rest of the API. The `/policy/evaluate`, `/receipt/*` endpoints
 * and the read-only utilities have no IO at all and never persist any
 * state; everything else mirrors a buyer-kit codepath verbatim.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  computeFeeAtoms,
  computeReceiptHash,
  currencyForAsset,
  decodePaymentResponseHeader,
  defaultFacilitatorFor,
  evaluate,
  finalizeReceipt,
  KNOWN_STABLE_SYMBOLS,
  KNOWN_TOKENS,
  lookupTokenBySymbol,
  networkFromCaip2,
  parseLeashFeeExtra,
  paymentRequirementsHash,
  requestHash,
  resolveLeashFeeBps,
  verifyReceiptChain,
  type KnownStableSymbol,
  type PaymentRequirements,
  type TokenNetwork,
} from '@leash/core';
import { ReceiptV1Schema, RulesV1Schema, type ReceiptV1 } from '@leash/schemas';
import { transferTokensChecked } from '@metaplex-foundation/mpl-toolbox';
import { publicKey } from '@metaplex-foundation/umi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import {
  ApiErrorSchema,
  NetworkSchema,
  PreparedEnvelopeOpenApi,
  PubkeySchema,
  SignerOptionsSchema,
  TokenProgramFlavorSchema,
} from '../openapi/common.js';
import { invalidRequest, rpcError } from '../util/errors.js';
import { networkToCaip2, type SvmNetwork } from '../util/network.js';
import { umiForRequest, umiReadOnly } from '../util/umi.js';
import { wrapPrepared } from '../util/prepare.js';
import { ingestReceipt } from '../storage/receipts.js';
import { createPreparedEvent, markConfirmed, markSubmitted } from '../storage/events.js';
import { ensureWatched } from '../indexer/watchlist.js';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';

const StableSchema = z.enum(
  KNOWN_STABLE_SYMBOLS as readonly [KnownStableSymbol, ...KnownStableSymbol[]],
);

const PaymentRequirementsSchema = z
  .object({
    scheme: z.string(),
    network: z.string(),
    asset: z.string(),
    payTo: z.string(),
    amount: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    maxTimeoutSeconds: z.number().int().optional(),
    resource: z.string().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .openapi('PaymentRequirements');

// --------------------------------------------------------------------
// /v1/buyer/quote
// --------------------------------------------------------------------
const QuoteBody = z
  .object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().nullable().optional(),
    /** Stablecoin to prefer when the seller advertises multiple `accepts[]`. */
    preferred_currency: StableSchema.optional(),
  })
  .openapi('BuyerQuoteBody');

const PriceSchema = z
  .object({
    amount: z.string(),
    currency: z.string(),
    network: z.string().optional(),
    asset: z.string().optional(),
    /**
     * Leash protocol fee in atomic units. Present when the seller's
     * `paymentRequirements.extra['leash.fee']` is set — this is the
     * additional amount the buyer pays on top of `amount` (the seller's
     * net). Absent on vanilla x402 settlements.
     */
    fee: z.string().optional(),
    /**
     * Buyer-signed total in atomic units (`amount + fee`). Same provenance
     * rule as `fee` — only set when the seller advertised a Leash fee.
     */
    gross: z.string().optional(),
    /** Fee rate in basis points (e.g. `100` = 1%). */
    fee_bps: z.number().int().min(0).max(10_000).optional(),
    /** Pubkey of the wallet that received the fee leg. */
    fee_authority: z.string().optional(),
  })
  .openapi('Price');

const QuoteResponse = z
  .object({
    /** HTTP status the seller returned. `402` for a paywalled resource. */
    status: z.number().int(),
    /**
     * Decoded `accepts[]` from the seller's `payment-required` header.
     * Empty when the seller did not return a 402 or the header was
     * missing/malformed.
     */
    accepts: z.array(PaymentRequirementsSchema),
    /**
     * Best matching entry for the caller-scoped network, or `null` if
     * the seller does not accept payment on that network.
     */
    chosen: PaymentRequirementsSchema.nullable(),
    price: PriceSchema.nullable(),
    requirements_hash: z.string().nullable(),
    /** Raw `payment-required` header value (base64url). Useful for debugging. */
    payment_required_header: z.string().nullable(),
    /** Seller-provided error message, if any (decoded from header). */
    seller_error: z.string().nullable(),
  })
  .openapi('BuyerQuoteResponse');

// --------------------------------------------------------------------
// /v1/buyer/policy/evaluate
// --------------------------------------------------------------------
// `RulesV1Schema` is from `zod`, but `@hono/zod-openapi` re-exports its
// own `z`. They're structurally compatible; the cast keeps the type
// system happy without re-declaring the schema.
const PolicyRulesSchema = RulesV1Schema as unknown as z.ZodTypeAny;

const PolicyEvaluateBody = z
  .object({
    request: z.object({
      method: z.string(),
      url: z.string().url(),
      body: z.string().nullable().optional(),
      estimated_price: z.string().optional(),
    }),
    rules: PolicyRulesSchema,
    state: z
      .object({
        spent_today: z.string().default('0'),
        recent_request_hashes: z.array(z.string()).default([]),
      })
      .default({ spent_today: '0', recent_request_hashes: [] }),
  })
  .openapi('PolicyEvaluateBody');

const PolicyEvaluateResponse = z
  .object({
    decision: z.enum(['allow', 'deny']),
    reason: z.string().nullable(),
    request_hash: z.string(),
  })
  .openapi('PolicyEvaluateResponse');

// --------------------------------------------------------------------
// /v1/buyer/payment/prepare
// --------------------------------------------------------------------
const PaymentPrepareBody = SignerOptionsSchema.extend({
  /** SPL mint to transfer (must match `payment_requirements.asset`). */
  spl_mint: PubkeySchema,
  /** Recipient account (the seller's `payTo`, typically an Asset Signer PDA). */
  destination: PubkeySchema,
  /** Atomic units to transfer (matches `payment_requirements.amount`). */
  amount: z.string().regex(/^\d+$/),
  /** Token program flavor — defaults to classic SPL. */
  token_program: TokenProgramFlavorSchema.optional(),
  /** Optional override of the source ATA. Defaults to ATA(`payer`, `mint`). */
  source_token_account: PubkeySchema.optional(),
  /**
   * Mint decimals. Required because the runtime uses it as an integrity
   * check on `TransferChecked` — supplying it client-side avoids an extra
   * RPC fetch in the API.
   */
  decimals: z.number().int().min(0).max(255),
}).openapi('BuyerPaymentPrepareBody');

const PaymentPrepareEcho = z
  .object({
    source_token_account: PubkeySchema,
    destination_token_account: PubkeySchema,
    mint: PubkeySchema,
    amount: z.string(),
    decimals: z.number().int().min(0).max(255),
    token_program: PubkeySchema,
  })
  .openapi('BuyerPaymentPrepareEcho');

// --------------------------------------------------------------------
// /v1/buyer/payment/execute
// --------------------------------------------------------------------
const PaymentExecuteBody = z
  .object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().nullable().optional(),
    /**
     * The full `X-PAYMENT` header value the caller signed off-chain.
     * Forwarded verbatim to the seller. Typically constructed from the
     * `paymentRequirements` returned by `/v1/buyer/quote` plus a signed
     * SPL `TransferChecked` from `/v1/buyer/payment/prepare`.
     */
    x_payment: z.string(),
    /** Agent asset whose receipt chain this call belongs to. */
    agent: PubkeySchema,
    /** Receipt nonce; caller manages chain state. */
    nonce: z.number().int().nonnegative(),
    /** Previous `receipt_hash`, or `null` for the first receipt in the chain. */
    prev_receipt_hash: z.string().nullable().optional(),
    /** Policy version recorded on the receipt (defaults to `'0.1'`). */
    policy_v: z.string().default('0.1'),
    /**
     * Hint of what the caller expects to settle. Used to fail loudly
     * when the seller demands more than the buyer pre-evaluated against.
     */
    expected_payment: PaymentRequirementsSchema.optional(),
    /**
     * Facilitator URL recorded on the receipt. Defaults to the API's
     * configured facilitator (`LEASH_API_FACILITATOR_URL`) for the
     * caller-scoped network.
     */
    facilitator: z.string().url().optional(),
  })
  .openapi('BuyerPaymentExecuteBody');

const PaymentExecuteResponse = z
  .object({
    settled: z.boolean(),
    response: z.object({
      status: z.number().int(),
      headers: z.record(z.string(), z.string()),
      body_text: z.string().nullable(),
    }),
    tx_sig: z.string().nullable(),
    receipt: ReceiptV1Schema as unknown as z.ZodTypeAny,
    receipt_event_id: z.string().nullable(),
    failure_reason: z.string().nullable(),
  })
  .openapi('BuyerPaymentExecuteResponse');

// --------------------------------------------------------------------
// /v1/buyer/receipt/finalize + /verify
// --------------------------------------------------------------------
const ReceiptDraftSchema = (ReceiptV1Schema as unknown as z.AnyZodObject)
  .omit({ receipt_hash: true })
  .openapi('ReceiptDraft');

const ReceiptFinalizeResponse = z
  .object({
    receipt_hash: z.string(),
    receipt: ReceiptV1Schema as unknown as z.ZodTypeAny,
  })
  .openapi('ReceiptFinalizeResponse');

const ReceiptVerifyBody = z
  .union([
    z.object({ chain: z.array(ReceiptV1Schema as unknown as z.ZodTypeAny).min(1) }),
    z.object({ jsonl: z.string().min(1) }),
  ])
  .openapi('ReceiptVerifyBody');

const ReceiptVerifyResponse = z
  .union([
    z.object({ ok: z.literal(true), count: z.number().int().nonnegative() }),
    z.object({
      ok: z.literal(false),
      nonce: z.number().int().nonnegative(),
      reason: z.string(),
    }),
  ])
  .openapi('ReceiptVerifyResponse');

// --------------------------------------------------------------------
// /v1/buyer/networks + /v1/buyer/currency
// --------------------------------------------------------------------
const BuyerCurrencySchema = z
  .object({
    symbol: StableSchema,
    name: z.string(),
    mint: PubkeySchema,
    decimals: z.number().int().min(0).max(255),
    program: z.enum(['spl-token', 'spl-token-2022']),
  })
  .openapi('BuyerCurrency');

const BuyerNetworkInfoSchema = z
  .object({
    network: NetworkSchema,
    caip2: z.string(),
    facilitator: z.string().url(),
    accepts: z.array(StableSchema),
    currencies: z.array(BuyerCurrencySchema),
  })
  .openapi('BuyerNetworkInfo');

const BuyerNetworksResponseSchema = z
  .object({
    items: z.array(BuyerNetworkInfoSchema),
    current: BuyerNetworkInfoSchema,
  })
  .openapi('BuyerNetworksResponse');

const BuyerCurrencyResponseSchema = z
  .object({
    network: NetworkSchema,
    items: z.array(BuyerCurrencySchema),
  })
  .openapi('BuyerCurrencyResponse');

export type BuyerRoutesDeps = {
  config: LeashApiConfig;
  db: DbClient;
};

export function buildBuyerRoutes(deps: BuyerRoutesDeps): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  // -----------------------------------------------------------------
  // POST /v1/buyer/quote
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/buyer/quote',
      tags: ['buyer'],
      summary: 'Probe a URL for an x402 402 + decode the `payment-required` header.',
      request: {
        body: { required: true, content: { 'application/json': { schema: QuoteBody } } },
      },
      responses: {
        200: {
          description: 'Quote envelope with raw `accepts[]` + caller-network pick.',
          content: { 'application/json': { schema: QuoteResponse } },
        },
        502: {
          description: 'The probe fetch failed (DNS, TLS, timeout, etc.).',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network = c.var.network;
      const method = body.method ?? 'GET';
      let res: Response;
      try {
        res = await fetch(body.url, {
          method,
          ...(body.headers ? { headers: body.headers } : {}),
          ...(body.body != null ? { body: body.body } : {}),
          redirect: 'manual',
        });
      } catch (err) {
        throw rpcError(`quote probe failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      const header =
        res.headers.get('payment-required') ?? res.headers.get('PAYMENT-REQUIRED') ?? null;
      let accepts: PaymentRequirements[] = [];
      let sellerError: string | null = null;
      if (header) {
        const decoded = safeBase64Json(header) as {
          error?: string;
          accepts?: PaymentRequirements[];
        } | null;
        if (decoded) {
          if (typeof decoded.error === 'string' && decoded.error.length > 0) {
            sellerError = decoded.error;
          }
          if (Array.isArray(decoded.accepts)) accepts = decoded.accepts;
        }
      }
      const chosen = pickRequirementsForNetwork(accepts, network, body.preferred_currency);
      const price = chosen ? toPrice(chosen) : null;
      return c.json(
        {
          status: res.status,
          accepts,
          chosen,
          price,
          requirements_hash: paymentRequirementsHash(chosen),
          payment_required_header: header,
          seller_error: sellerError,
        },
        200,
      );
    },
  );

  // -----------------------------------------------------------------
  // POST /v1/buyer/policy/evaluate
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/buyer/policy/evaluate',
      tags: ['buyer'],
      summary: 'Pure RulesV1 gate. No IO, no DB writes.',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: PolicyEvaluateBody } },
        },
      },
      responses: {
        200: {
          description: 'Decision + diagnostic fields.',
          content: { 'application/json': { schema: PolicyEvaluateResponse } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json') as z.infer<typeof PolicyEvaluateBody>;
      const h = requestHash({
        method: body.request.method.toUpperCase(),
        url: body.request.url,
        body: body.request.body ?? null,
      });
      const decision = evaluate(
        {
          method: body.request.method.toUpperCase(),
          url: body.request.url,
          requestHash: h,
          ...(body.request.estimated_price ? { estimatedPrice: body.request.estimated_price } : {}),
        },
        body.rules as never,
        {
          rules: body.rules as never,
          spentToday: body.state.spent_today,
          recentRequestHashes: body.state.recent_request_hashes,
        },
      );
      return c.json(
        {
          decision: decision.decision,
          reason: decision.decision === 'deny' ? decision.reason : null,
          request_hash: h,
        },
        200,
      );
    },
  );

  // -----------------------------------------------------------------
  // POST /v1/buyer/payment/prepare
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/buyer/payment/prepare',
      tags: ['buyer'],
      summary: 'Build an unsigned SPL TransferChecked from buyer ATA → seller payTo ATA.',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: PaymentPrepareBody } },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction + echo of the resolved ATAs.',
          content: {
            'application/json': { schema: PreparedEnvelopeOpenApi(PaymentPrepareEcho) },
          },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network = c.var.network;
      const apiKey = c.var.apiKey;
      const tokenProgram =
        body.token_program === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
      const umi = umiForRequest(deps.config, {
        network,
        payer: body.payer,
        ...(body.authority ? { authority: body.authority } : {}),
      });
      // Lazy-import findAssociatedTokenPda from mpl-toolbox via the
      // installed plugin set on `umi` to avoid bundle bloat in code paths
      // that don't need ATA derivation.
      const { findAssociatedTokenPda } = await import('@metaplex-foundation/mpl-toolbox');
      const sourceAtaPk = body.source_token_account
        ? publicKey(body.source_token_account)
        : findAssociatedTokenPda(umi, {
            mint: publicKey(body.spl_mint),
            owner: publicKey(body.payer),
            tokenProgramId: tokenProgram,
          })[0];
      const [destinationAta] = findAssociatedTokenPda(umi, {
        mint: publicKey(body.spl_mint),
        owner: publicKey(body.destination),
        tokenProgramId: tokenProgram,
      });
      const amount = BigInt(body.amount);
      const builder = transferTokensChecked(umi, {
        source: sourceAtaPk,
        mint: publicKey(body.spl_mint),
        destination: destinationAta,
        amount,
        decimals: body.decimals,
      });
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'buyer.payment.prepare',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        mint: body.spl_mint,
        amountAtomic: amount,
        builder,
        echo: {
          source_token_account: String(sourceAtaPk),
          destination_token_account: String(destinationAta),
          mint: body.spl_mint,
          amount: body.amount,
          decimals: body.decimals,
          token_program: String(tokenProgram),
        },
      });
      return c.json(result, 200);
    },
  );

  // -----------------------------------------------------------------
  // POST /v1/buyer/payment/execute
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/buyer/payment/execute',
      tags: ['buyer'],
      summary: 'Replay a seller request with a buyer-signed `X-PAYMENT` header + ingest receipt.',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: PaymentExecuteBody } },
        },
      },
      responses: {
        200: {
          description: 'Settlement attempt summary + spend receipt.',
          content: { 'application/json': { schema: PaymentExecuteResponse } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json') as z.infer<typeof PaymentExecuteBody>;
      const network = c.var.network;
      const apiKey = c.var.apiKey;
      const facilitator =
        body.facilitator ?? deps.config.facilitatorUrl ?? defaultFacilitatorFor([network]);

      const headers: Record<string, string> = {
        ...(body.headers ?? {}),
        'X-PAYMENT': body.x_payment,
      };
      const requestBody = body.body ?? null;
      const bodyHash = requestBody
        ? requestHash({ method: body.method, url: body.url, body: requestBody })
        : null;

      let response: Response;
      let networkError: string | null = null;
      try {
        response = await fetch(body.url, {
          method: body.method,
          headers,
          ...(requestBody != null ? { body: requestBody } : {}),
          redirect: 'manual',
        });
      } catch (err) {
        networkError = err instanceof Error ? err.message : String(err);
        response = new Response(JSON.stringify({ error: networkError }), {
          status: 0,
          statusText: 'Network error',
        });
      }

      const settlement = parseSettlementHeader(response);
      const settled = settlement?.txSig != null && settlement.txSig.length > 0;
      const decision: 'allow' | 'rejected' = settled ? 'allow' : 'rejected';
      const failureReason = settled
        ? null
        : (networkError ?? `seller did not settle (status=${response.status})`);

      const expectedPayment = (body.expected_payment ?? null) as PaymentRequirements | null;
      const price = settlement?.price ?? (expectedPayment ? toPrice(expectedPayment) : null);
      const requirementsHash =
        settlement?.requirementsHash ?? paymentRequirementsHash(expectedPayment);

      const draft = {
        v: '0.1' as const,
        kind: 'spend' as const,
        agent: body.agent,
        nonce: body.nonce,
        ts: new Date().toISOString(),
        policy_v: body.policy_v,
        request: {
          method: body.method,
          url: body.url,
          body_hash: bodyHash,
        },
        decision,
        reason: failureReason,
        price,
        facilitator,
        tx_sig: settlement?.txSig ?? null,
        payment_requirements_hash: requirementsHash,
        response: { status: response.status, body_hash: null },
        prev_receipt_hash: body.prev_receipt_hash ?? null,
      };
      const receipt = finalizeReceipt(draft);

      // Ingest the receipt (idempotent on receipt_hash) so the explorer
      // can show it. Wrap in try/catch so a DB hiccup never poisons the
      // synchronous response — the receipt is fully in-hand client-side.
      let eventId: string | null = null;
      try {
        const ingest = await ingestReceipt(deps.db, { network, receipt });
        if (!ingest.duplicate) {
          eventId = await createPreparedEvent(deps.db, {
            kind: 'receipt.published',
            network,
            apiKeyId: apiKey.id,
            agentAsset: body.agent,
            metadata: {
              receipt_hash: receipt.receipt_hash,
              ...(receipt.tx_sig ? { tx_sig: receipt.tx_sig } : {}),
            },
          });
          if (receipt.tx_sig) await markSubmitted(deps.db, eventId, receipt.tx_sig);
          await markConfirmed(deps.db, eventId);
        }
        try {
          const umi = umiReadOnly(deps.config, network);
          const [treasury] = findAssetSignerPda(umi, { asset: publicKey(body.agent) });
          await ensureWatched(deps.db, {
            network,
            agentAsset: body.agent,
            treasuryAddress: String(treasury),
          });
        } catch {
          // best-effort
        }
      } catch {
        // best-effort
      }

      // Drain the body for the caller — we already used the headers.
      let bodyText: string | null = null;
      try {
        bodyText = await response.text();
      } catch {
        bodyText = null;
      }
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      return c.json(
        {
          settled,
          response: { status: response.status, headers: responseHeaders, body_text: bodyText },
          tx_sig: settlement?.txSig ?? null,
          receipt: receipt as unknown,
          receipt_event_id: eventId,
          failure_reason: failureReason,
        },
        200,
      );
    },
  );

  // -----------------------------------------------------------------
  // POST /v1/buyer/receipt/finalize
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/buyer/receipt/finalize',
      tags: ['buyer'],
      summary: 'Compute `receipt_hash` for a draft receipt (pure).',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: ReceiptDraftSchema } },
        },
      },
      responses: {
        200: {
          description: 'Hashed receipt.',
          content: { 'application/json': { schema: ReceiptFinalizeResponse } },
        },
      },
    }),
    async (c) => {
      const draft = c.req.valid('json') as Omit<ReceiptV1, 'receipt_hash'>;
      const receipt = finalizeReceipt(draft);
      return c.json({ receipt_hash: receipt.receipt_hash, receipt: receipt as unknown }, 200);
    },
  );

  // -----------------------------------------------------------------
  // POST /v1/buyer/receipt/verify
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/buyer/receipt/verify',
      tags: ['buyer'],
      summary: 'Verify a chain of receipts (hashes, nonces, prev links).',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: ReceiptVerifyBody } },
        },
      },
      responses: {
        200: {
          description: 'Verification outcome.',
          content: { 'application/json': { schema: ReceiptVerifyResponse } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json') as { chain: ReceiptV1[] } | { jsonl: string };
      const lines =
        'jsonl' in body
          ? body.jsonl.split(/\r?\n/).filter((l) => l.trim().length > 0)
          : body.chain.map((r) => JSON.stringify(r));
      const result = verifyReceiptChain(lines);
      return c.json(result, 200);
    },
  );

  // -----------------------------------------------------------------
  // GET /v1/buyer/networks
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/buyer/networks',
      tags: ['buyer'],
      summary: 'Buyer-side network catalog (mirrors `/v1/seller/networks`).',
      responses: {
        200: {
          description: 'Network catalog with caller-scoped network as `current`.',
          content: { 'application/json': { schema: BuyerNetworksResponseSchema } },
        },
      },
    }),
    async (c) => {
      const items = (['solana-devnet', 'solana-mainnet'] as const).map((n) =>
        buildBuyerNetwork(deps.config, n),
      );
      const current = items.find((i) => i.network === c.var.network) ?? items[0];
      return c.json({ items, current }, 200);
    },
  );

  // -----------------------------------------------------------------
  // GET /v1/buyer/currency
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/buyer/currency',
      tags: ['buyer'],
      summary: 'Stablecoins the buyer can settle in on the caller-scoped network.',
      responses: {
        200: {
          description: 'Currency list.',
          content: { 'application/json': { schema: BuyerCurrencyResponseSchema } },
        },
      },
    }),
    async (c) => {
      const network = c.var.network;
      const tokenNetwork: TokenNetwork = network === 'solana-devnet' ? 'devnet' : 'mainnet';
      const items = KNOWN_STABLE_SYMBOLS.flatMap((sym) => {
        const tok = lookupTokenBySymbol(sym, tokenNetwork);
        return tok
          ? [
              {
                symbol: sym,
                name: tok.name,
                mint: tok.mint,
                decimals: tok.decimals,
                program: tok.program,
              },
            ]
          : [];
      });
      return c.json({ network, items }, 200);
    },
  );

  return app;
}

// --------------------------------------------------------------------
// Helpers (private to the buyer module)
// --------------------------------------------------------------------

/**
 * Pick the entry from a seller's `accepts[]` that the caller can settle
 * on — preferring the network they're scoped to, then a preferred
 * currency override, then the first matching network entry.
 */
function pickRequirementsForNetwork(
  accepts: PaymentRequirements[],
  network: SvmNetwork,
  preferred: KnownStableSymbol | undefined,
): PaymentRequirements | null {
  const matching = accepts.filter((r) => caip2NetworkMatches(r.network, network));
  if (matching.length === 0) return null;
  if (preferred) {
    const tokenNetwork: TokenNetwork = network === 'solana-devnet' ? 'devnet' : 'mainnet';
    const tok = lookupTokenBySymbol(preferred, tokenNetwork);
    if (tok) {
      const hit = matching.find((r) => r.asset === tok.mint);
      if (hit) return hit;
    }
  }
  return matching[0] ?? null;
}

function caip2NetworkMatches(headerNetwork: string, network: SvmNetwork): boolean {
  // Sellers may stamp either the friendly slug or the CAIP-2 form. Match
  // both so we're robust to either.
  if (headerNetwork === network) return true;
  if (headerNetwork === networkToCaip2(network)) return true;
  const slug = networkFromCaip2(headerNetwork);
  return slug === network;
}

function toPrice(req: PaymentRequirements) {
  const slug = networkFromCaip2(req.network) ?? req.network;
  const tokenNetwork: TokenNetwork = slug === 'solana-mainnet' ? 'mainnet' : 'devnet';
  // Surface fee + gross when the seller advertised a Leash fee in
  // `extra['leash.fee']`. Computed off the same `amount` (net) so the
  // numbers always reconcile with what the facilitator + buyer-kit
  // derived for the actual on-chain transaction.
  const feeExtra = parseLeashFeeExtra(req.extra ?? null);
  const base = {
    amount: req.amount,
    currency: currencyForAsset(req.asset, tokenNetwork),
    network: slug,
    asset: req.asset,
  };
  if (!feeExtra) return base;
  let net: bigint;
  try {
    net = BigInt(req.amount);
  } catch {
    return base;
  }
  const fee = computeFeeAtoms(net, feeExtra.bps);
  return {
    ...base,
    fee: fee.toString(),
    gross: (net + fee).toString(),
    fee_bps: feeExtra.bps,
    fee_authority: feeExtra.feeAuthority,
  };
}

type Settlement = {
  txSig: string | null;
  price: ReceiptV1['price'];
  requirementsHash: string | null;
};

function parseSettlementHeader(response: Response): Settlement | null {
  const header =
    response.headers.get('PAYMENT-RESPONSE') ??
    response.headers.get('X-PAYMENT-RESPONSE') ??
    response.headers.get('payment-response');
  if (!header) return null;
  let decoded: unknown;
  try {
    decoded = decodePaymentResponseHeader(header);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object') return null;
  const obj = decoded as { transaction?: string; paymentRequirements?: PaymentRequirements };
  const txSig =
    typeof obj.transaction === 'string' && obj.transaction.length > 0 ? obj.transaction : null;
  const requirements = obj.paymentRequirements ?? null;
  return {
    txSig,
    price: requirements ? toPrice(requirements) : null,
    requirementsHash: paymentRequirementsHash(requirements),
  };
}

function safeBase64Json(input: string): unknown {
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const raw =
      typeof globalThis.atob === 'function'
        ? globalThis.atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildBuyerNetwork(config: LeashApiConfig, network: SvmNetwork) {
  const tokenNetwork: TokenNetwork = network === 'solana-devnet' ? 'devnet' : 'mainnet';
  const configured = config.facilitatorUrl?.trim();
  const facilitator =
    configured && configured.length > 0 ? configured : defaultFacilitatorFor([network]);
  const currencies = KNOWN_STABLE_SYMBOLS.flatMap((sym) => {
    const tok = lookupTokenBySymbol(sym, tokenNetwork);
    return tok
      ? [
          {
            symbol: sym,
            name: tok.name,
            mint: tok.mint,
            decimals: tok.decimals,
            program: tok.program,
          },
        ]
      : [];
  });
  return {
    network,
    caip2: networkToCaip2(network),
    facilitator,
    accepts: [...KNOWN_STABLE_SYMBOLS],
    currencies,
  };
}

// Re-imported locally so the buyer file doesn't pull in @leash/registry-utils
// just for the program-id constants. The values are stable Solana program ids.
import { publicKey as _pk } from '@metaplex-foundation/umi';
const SPL_TOKEN_PROGRAM_ID = _pk('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = _pk('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// Touched to silence unused warnings when consumers strip imports.
void computeReceiptHash;
void KNOWN_TOKENS;
