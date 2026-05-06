/**
 * Payment-link CRUD + paywall preview.
 *
 * Mirrors `@leashmarket/seller-kit`'s `createSeller(...)` shape: an agent
 * owner declares (`method` + `price` + `currency` + `response`) and
 * the API hosts the paywall on `/x/{id}` (see `routes/paywall.ts`).
 *
 * Endpoints (all api-key scoped; network from the key prefix):
 *   - POST   /v1/payment-links             — create a new link
 *   - GET    /v1/payment-links             — list links owned by caller
 *   - GET    /v1/payment-links/{id}        — fetch one link by slug
 *   - PATCH  /v1/payment-links/{id}        — update label/price/etc.
 *   - DELETE /v1/payment-links/{id}        — remove
 *   - POST   /v1/payment-links/preview     — render discovery JSON
 *                                            for a draft (no persist)
 *
 * The discovery payload (`/v1/payment-links/{id}` and the public
 * `GET /x/{id}` paywall) intentionally mirrors what
 * `@x402/core/server` advertises in its 402 body so SDK callers can
 * decode either with the same code path.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import { ulid } from 'ulid';
import {
  KNOWN_STABLE_SYMBOLS,
  buildLeashFeeExtra,
  computeFeeAtoms,
  resolveLeashFeeBps,
  type KnownStableSymbol,
  type LeashFeeExtra,
  type TokenNetwork,
} from '@leashmarket/core';
import { EndpointIdSchema, EndpointMethodSchema } from '@leashmarket/schemas';
import { parsePrice } from '@leashmarket/seller-kit';

import type { AuthVariables } from '../auth/types.js';
import { type LeashApiConfig, facilitatorForNetwork } from '../config.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import {
  createPaymentLink,
  deletePaymentLink,
  getPaymentLinkScoped,
  listPaymentLinks,
  PaymentLinkConflictError,
  updatePaymentLink,
  type PaymentLinkResponse,
  type PaymentLinkRow,
} from '../storage/payment-links.js';
import { createPreparedEvent, markConfirmed } from '../storage/events.js';
import { ensureWatched } from '../indexer/watchlist.js';
import { umiReadOnly } from '../util/umi.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { conflict, invalidRequest, notFound } from '../util/errors.js';
import { networkToCaip2 } from '../util/network.js';

const StableSchema = z.enum(
  KNOWN_STABLE_SYMBOLS as readonly [KnownStableSymbol, ...KnownStableSymbol[]],
);

const LeashFeeExtraSchema = z
  .object({
    v: z.literal('1'),
    bps: z.number().int().nonnegative().max(10_000),
    feeAuthority: PubkeySchema,
  })
  .openapi('LeashFeeExtra');

const AcceptsEntrySchema = z
  .object({
    scheme: z.literal('exact'),
    network: z.string(),
    pay_to: PubkeySchema,
    asset: PubkeySchema,
    amount: z.string().openapi({
      description:
        'Net (seller-quoted) atomic amount. The buyer actually signs ' +
        'for `gross_amount = amount + fee_amount`.',
    }),
    currency: StableSchema,
    fee_amount: z.string().openapi({
      description: 'Leash protocol fee in atomic units of `asset`.',
    }),
    gross_amount: z.string().openapi({
      description: 'Total atomic amount the buyer signs (`amount + fee_amount`).',
    }),
    fee_bps: z.number().int().nonnegative().max(10_000),
    fee_authority: PubkeySchema.openapi({
      description: 'Treasury wallet that owns the destination fee ATA.',
    }),
    leash_fee: LeashFeeExtraSchema.openapi({
      description:
        'Wire shape stamped onto x402 ' +
        "`paymentRequirements.extra['leash.fee']`. Buyers and facilitators " +
        'derive the destination ATA from `(feeAuthority, asset, tokenProgram)`.',
    }),
  })
  .openapi('PaymentLinkAcceptsEntry');

const ResponseTemplateSchema = z
  .object({
    status: z.number().int().min(100).max(599).default(200),
    mimeType: z.string().default('application/json'),
    body: z.union([z.string(), z.record(z.unknown())]),
  })
  .openapi('PaymentLinkResponseTemplate');

const PaymentLinkCreateBody = z
  .object({
    id: EndpointIdSchema.optional(),
    label: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    owner_agent: PubkeySchema,
    owner_wallet: PubkeySchema.optional(),
    method: EndpointMethodSchema.default('GET'),
    price: z
      .string()
      .min(1)
      .openapi({
        description:
          'Display price string (e.g. `"$0.001"`, `"0.01 USDC"`, `"0.5"`). ' +
          'Parsed at advertise/settle time via the same `parsePrice` rules ' +
          '`@leashmarket/seller-kit` uses, so atomic units always match.',
      }),
    currency: StableSchema.default('USDC'),
    accepts_currencies: z.array(StableSchema).max(3).default([]),
    response: ResponseTemplateSchema,
    webhook_url: z.string().url().optional(),
    wrap_receipt: z.boolean().default(false),
    metadata: z.record(z.unknown()).optional(),
  })
  .openapi('PaymentLinkCreateBody');

const PaymentLinkPatchBody = z
  .object({
    label: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    price: z.string().min(1).optional(),
    currency: StableSchema.optional(),
    accepts_currencies: z.array(StableSchema).max(3).optional(),
    response: ResponseTemplateSchema.optional(),
    webhook_url: z.string().url().nullable().optional(),
    wrap_receipt: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
    disabled: z.boolean().optional(),
  })
  .openapi('PaymentLinkPatchBody');

const PaymentLinkSchema = z
  .object({
    id: z.string(),
    network: NetworkSchema,
    label: z.string(),
    description: z.string().nullable(),
    owner_agent: PubkeySchema,
    owner_wallet: PubkeySchema.nullable(),
    pay_to: PubkeySchema.openapi({
      description: 'Asset Signer PDA derived from `owner_agent`. The on-chain `payTo`.',
    }),
    method: EndpointMethodSchema,
    path: z.string(),
    price: z.string(),
    currency: StableSchema,
    accepts_currencies: z.array(StableSchema),
    response: ResponseTemplateSchema,
    webhook_url: z.string().url().nullable(),
    wrap_receipt: z.boolean(),
    metadata: z.record(z.unknown()),
    facilitator: z.string().url(),
    share_url: z.string().url().openapi({
      description: 'Public paywall URL — share this. Resolves to `/x/{id}` on the API.',
    }),
    accepts: z.array(AcceptsEntrySchema),
    counters: z.object({
      call_count: z.number().int().nonnegative(),
      settled_count: z.number().int().nonnegative(),
      last_called_at: z.string().nullable(),
      last_settled_at: z.string().nullable(),
      last_tx_sig: z.string().nullable(),
      last_settled_amount_atomic: z.string().nullable(),
      last_settled_currency: z.string().nullable(),
    }),
    disabled_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('PaymentLink');

type AcceptsEntry = {
  scheme: 'exact';
  network: string;
  pay_to: string;
  asset: string;
  /**
   * Net (seller-quoted) atomic amount. Equal to `parsePrice(price).amount`.
   * Buyers actually sign for `gross_amount = amount + fee_amount`.
   */
  amount: string;
  currency: KnownStableSymbol;
  /**
   * Atomic Leash protocol fee that will be debited on top of `amount`,
   * always in the same `asset`. `null` only when fees are explicitly
   * disabled by env override (`LEASH_FEE_BPS=0`).
   */
  fee_amount: string;
  /** Atomic total the buyer signs (`amount + fee_amount`). */
  gross_amount: string;
  /** Fee rate in basis points used to derive `fee_amount`. */
  fee_bps: number;
  /**
   * Treasury authority (wallet pubkey) that owns the destination ATA on
   * `asset`. Buyer + facilitator both derive the destination ATA from
   * `(authority, asset, tokenProgram)` so it never lives on the wire.
   */
  fee_authority: string;
  /** Wire shape stamped onto x402 `paymentRequirements.extra['leash.fee']`. */
  leash_fee: LeashFeeExtra;
};

type DiscoveryView = {
  pay_to: string;
  facilitator: string;
  share_url: string;
  accepts: AcceptsEntry[];
};

export type PaymentLinkRoutesDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
};

export function buildPaymentLinkRoutes(
  deps: PaymentLinkRoutesDeps,
): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  // -----------------------------------------------------------------
  // POST /v1/payment-links
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/payment-links',
      tags: ['payment-links'],
      summary: 'Create a hosted x402 payment link.',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: PaymentLinkCreateBody } },
        },
      },
      responses: {
        200: {
          description: 'Payment link created. `share_url` is the public paywall.',
          content: { 'application/json': { schema: PaymentLinkSchema } },
        },
        409: {
          description: 'A payment link with this id already exists on the caller network.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        422: {
          description: 'Invalid body (price unparseable, currency unsupported, etc).',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network = c.var.network;
      const tokenNetwork: TokenNetwork = network === 'solana-devnet' ? 'devnet' : 'mainnet';

      validatePriceForCurrencies(
        body.price,
        [body.currency, ...body.accepts_currencies],
        tokenNetwork,
      );

      const id = body.id ?? generateSlug();
      const path = `/x/${id}`;
      let row: PaymentLinkRow;
      try {
        row = await createPaymentLink(deps.db, {
          network,
          apiKeyId: c.var.apiKey.id,
          id,
          label: body.label,
          description: body.description ?? null,
          ownerAgent: body.owner_agent,
          ownerWallet: body.owner_wallet ?? null,
          method: body.method,
          path,
          price: body.price,
          currency: body.currency,
          acceptsCurrencies: body.accepts_currencies,
          response: body.response as PaymentLinkResponse,
          webhookUrl: body.webhook_url ?? null,
          wrapReceipt: body.wrap_receipt,
          metadata: body.metadata ?? {},
        });
      } catch (err) {
        if (err instanceof PaymentLinkConflictError) {
          throw conflict(err.message);
        }
        throw err;
      }

      // Side-effect 1: enroll the agent in the indexer watchlist so
      // anyone hitting the paywall lights up the explorer feed.
      await tryWatchAgent(deps, network, body.owner_agent);

      // Side-effect 2: drop a `payment_link.created` event so usage
      // metrics + webhook subscribers see new links land in real time.
      const eventId = await createPreparedEvent(deps.db, {
        kind: 'payment_link.created',
        network,
        apiKeyId: c.var.apiKey.id,
        agentAsset: body.owner_agent,
        metadata: { payment_link_id: id, price: body.price, currency: body.currency },
      });
      await markConfirmed(deps.db, eventId);

      return c.json(rowToWire(row, deps.config), 200);
    },
  );

  // -----------------------------------------------------------------
  // GET /v1/payment-links
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/payment-links',
      tags: ['payment-links'],
      summary: 'List payment links owned by the caller (newest first).',
      request: {
        query: z.object({
          owner_agent: PubkeySchema.optional(),
          include_disabled: z
            .enum(['true', 'false'])
            .optional()
            .openapi({ description: 'Default false.' }),
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: {
        200: {
          description: 'Paged links.',
          content: {
            'application/json': {
              schema: z.object({
                items: z.array(PaymentLinkSchema),
                next_cursor: z.string().nullable(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const limit = q.limit ?? 50;
      const rows = await listPaymentLinks(deps.db, {
        network: c.var.network,
        apiKeyId: c.var.apiKey.id,
        ownerAgent: q.owner_agent ?? null,
        includeDisabled: q.include_disabled === 'true',
        cursor: q.cursor ?? null,
        limit,
      });
      const last = rows[rows.length - 1];
      const nextCursor = last && rows.length === limit ? last.createdAt : null;
      return c.json(
        {
          items: rows.map((r) => rowToWire(r, deps.config)),
          next_cursor: nextCursor,
        },
        200,
      );
    },
  );

  // -----------------------------------------------------------------
  // GET /v1/payment-links/{id}
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/payment-links/{id}',
      tags: ['payment-links'],
      summary: 'Fetch a payment link by slug (must belong to caller).',
      request: { params: z.object({ id: EndpointIdSchema }) },
      responses: {
        200: {
          description: 'Payment link record.',
          content: { 'application/json': { schema: PaymentLinkSchema } },
        },
        404: {
          description: 'Not found.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const row = await getPaymentLinkScoped(deps.db, {
        network: c.var.network,
        apiKeyId: c.var.apiKey.id,
        id,
      });
      if (!row) throw notFound(`payment link "${id}" not found on ${c.var.network}`);
      return c.json(rowToWire(row, deps.config), 200);
    },
  );

  // -----------------------------------------------------------------
  // PATCH /v1/payment-links/{id}
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/payment-links/{id}',
      tags: ['payment-links'],
      summary: 'Update a payment link. Send only the fields you want to change.',
      request: {
        params: z.object({ id: EndpointIdSchema }),
        body: { required: true, content: { 'application/json': { schema: PaymentLinkPatchBody } } },
      },
      responses: {
        200: {
          description: 'Updated payment link.',
          content: { 'application/json': { schema: PaymentLinkSchema } },
        },
        404: {
          description: 'Not found.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        422: {
          description: 'Invalid patch (price unparseable, currency unsupported, etc).',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const network = c.var.network;
      const tokenNetwork: TokenNetwork = network === 'solana-devnet' ? 'devnet' : 'mainnet';
      // Pre-validate price/currency against each other if either changed.
      const existing = await getPaymentLinkScoped(deps.db, {
        network,
        apiKeyId: c.var.apiKey.id,
        id,
      });
      if (!existing) throw notFound(`payment link "${id}" not found on ${network}`);
      const nextCurrency = patch.currency ?? existing.currency;
      const nextAccepts = patch.accepts_currencies ?? existing.acceptsCurrencies;
      const nextPrice = patch.price ?? existing.price;
      if (
        patch.price !== undefined ||
        patch.currency !== undefined ||
        patch.accepts_currencies !== undefined
      ) {
        validatePriceForCurrencies(nextPrice, [nextCurrency, ...nextAccepts], tokenNetwork);
      }
      const updated = await updatePaymentLink(deps.db, {
        network,
        apiKeyId: c.var.apiKey.id,
        id,
        patch: {
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.price !== undefined ? { price: patch.price } : {}),
          ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
          ...(patch.accepts_currencies !== undefined
            ? { acceptsCurrencies: patch.accepts_currencies }
            : {}),
          ...(patch.response !== undefined
            ? { response: patch.response as PaymentLinkResponse }
            : {}),
          ...(patch.webhook_url !== undefined ? { webhookUrl: patch.webhook_url } : {}),
          ...(patch.wrap_receipt !== undefined ? { wrapReceipt: patch.wrap_receipt } : {}),
          ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
          ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
        },
      });
      if (!updated) throw notFound(`payment link "${id}" not found on ${network}`);

      const eventId = await createPreparedEvent(deps.db, {
        kind: 'payment_link.updated',
        network,
        apiKeyId: c.var.apiKey.id,
        agentAsset: updated.ownerAgent,
        metadata: { payment_link_id: id },
      });
      await markConfirmed(deps.db, eventId);

      return c.json(rowToWire(updated, deps.config), 200);
    },
  );

  // -----------------------------------------------------------------
  // DELETE /v1/payment-links/{id}
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/payment-links/{id}',
      tags: ['payment-links'],
      summary: 'Delete a payment link. The public paywall stops responding immediately.',
      request: { params: z.object({ id: EndpointIdSchema }) },
      responses: {
        200: {
          description: 'Deleted.',
          content: {
            'application/json': { schema: z.object({ ok: z.literal(true) }) },
          },
        },
        404: {
          description: 'Not found.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const existing = await getPaymentLinkScoped(deps.db, {
        network: c.var.network,
        apiKeyId: c.var.apiKey.id,
        id,
      });
      if (!existing) throw notFound(`payment link "${id}" not found on ${c.var.network}`);
      const deleted = await deletePaymentLink(deps.db, {
        network: c.var.network,
        apiKeyId: c.var.apiKey.id,
        id,
      });
      if (!deleted) throw notFound(`payment link "${id}" not found on ${c.var.network}`);

      const eventId = await createPreparedEvent(deps.db, {
        kind: 'payment_link.deleted',
        network: c.var.network,
        apiKeyId: c.var.apiKey.id,
        agentAsset: existing.ownerAgent,
        metadata: { payment_link_id: id },
      });
      await markConfirmed(deps.db, eventId);

      return c.json({ ok: true as const }, 200);
    },
  );

  // -----------------------------------------------------------------
  // POST /v1/payment-links/preview
  // -----------------------------------------------------------------
  // Render the discovery payload (`accepts[]`, `pay_to`, `share_url`,
  // `facilitator`) for a draft payment link without persisting it.
  // Useful for "what will my paywall advertise?" UIs and integration
  // tests — saves a destroy-and-recreate cycle.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/payment-links/preview',
      tags: ['payment-links'],
      summary: 'Preview the discovery payload for a draft payment link (no persist).',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: PaymentLinkCreateBody } },
        },
      },
      responses: {
        200: {
          description: 'Discovery payload that would be advertised on the paywall.',
          content: {
            'application/json': {
              schema: z.object({
                pay_to: PubkeySchema,
                facilitator: z.string().url(),
                share_url: z.string().url(),
                accepts: z.array(AcceptsEntrySchema),
              }),
            },
          },
        },
        422: {
          description: 'Invalid draft (price unparseable, currency unsupported, etc).',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network = c.var.network;
      const tokenNetwork: TokenNetwork = network === 'solana-devnet' ? 'devnet' : 'mainnet';
      validatePriceForCurrencies(
        body.price,
        [body.currency, ...body.accepts_currencies],
        tokenNetwork,
      );
      const id = body.id ?? generateSlug();
      const view = buildDiscoveryView(deps.config, network, {
        id,
        ownerAgent: body.owner_agent,
        price: body.price,
        currency: body.currency,
        acceptsCurrencies: body.accepts_currencies,
      });
      return c.json(
        {
          pay_to: view.pay_to,
          facilitator: view.facilitator,
          share_url: view.share_url,
          accepts: view.accepts,
        },
        200,
      );
    },
  );

  return app;
}

/**
 * Throw `invalidRequest` if `parsePrice(...)` returns null for the
 * primary currency or any extra accepted currency. Mirrors what
 * `@leashmarket/seller-kit` does at `createSeller` time so the paywall
 * never has to deal with an un-renderable price at runtime.
 */
function validatePriceForCurrencies(
  price: string,
  currencies: KnownStableSymbol[],
  network: TokenNetwork,
): void {
  for (const currency of currencies) {
    const parsed = parsePrice(price, { network, defaultCurrency: currency });
    if (!parsed) {
      throw invalidRequest(
        `unparseable price "${price}" for currency ${currency} on ${network} ` +
          `(supported tokens: ${KNOWN_STABLE_SYMBOLS.join(', ')})`,
      );
    }
  }
}

/**
 * Compute the public discovery view of a payment link. Used by both
 * the create + preview endpoints, and (eventually) by `/x/{id}` so
 * GET probes return the same JSON whether they go through the API
 * read endpoint or the paywall.
 */
export function buildDiscoveryView(
  config: LeashApiConfig,
  network: 'solana-devnet' | 'solana-mainnet',
  args: {
    id: string;
    ownerAgent: string;
    price: string;
    currency: KnownStableSymbol;
    acceptsCurrencies: KnownStableSymbol[];
  },
): DiscoveryView {
  const tokenNetwork: TokenNetwork = network === 'solana-devnet' ? 'devnet' : 'mainnet';
  // Resolve `pay_to` against a read-only Umi (no signer needed). This
  // always matches what `@leashmarket/seller-kit`'s `resolveSellerPayTo`
  // returns for the same asset.
  const umi = umiReadOnly(config, network);
  const [signer] = findAssetSignerPda(umi, { asset: publicKey(args.ownerAgent) });
  const payTo = String(signer);
  const networkCaip2 = networkToCaip2(network);
  const facilitator = facilitatorForNetwork(config, network);
  // Self-describing share URL: include `?network=<svm>` so a buyer who
  // shares the link without any context still hits the right paywall.
  // The paywall route also falls back to whichever network the slug
  // actually exists on, but baking the query in keeps things explicit
  // and makes the URL safe to embed in QR codes / receipts.
  const shareUrl = `${config.publicOrigin.replace(/\/+$/, '')}/x/${args.id}?network=${network}`;

  // Stamp every advertised entry with the same Leash fee block. Bps +
  // authority are constant per network — only the destination ATA
  // differs by asset, and that's derived buyer/facilitator-side from
  // `(authority, asset, tokenProgram)` so it stays off the wire.
  const leashFee = buildLeashFeeExtra({ network: tokenNetwork });
  const feeBps = resolveLeashFeeBps();
  const allCurrencies = uniq([args.currency, ...args.acceptsCurrencies]);
  const accepts: AcceptsEntry[] = [];
  for (const currency of allCurrencies) {
    const parsed = parsePrice(args.price, { network: tokenNetwork, defaultCurrency: currency });
    if (!parsed || !parsed.asset) continue;
    const netAtomic = BigInt(parsed.amount);
    const feeAtomic = computeFeeAtoms(netAtomic, feeBps);
    accepts.push({
      scheme: 'exact',
      network: networkCaip2,
      pay_to: payTo,
      asset: parsed.asset,
      amount: parsed.amount,
      currency,
      fee_amount: feeAtomic.toString(),
      gross_amount: (netAtomic + feeAtomic).toString(),
      fee_bps: feeBps,
      fee_authority: leashFee.feeAuthority,
      leash_fee: leashFee,
    });
  }

  return { pay_to: payTo, facilitator, share_url: shareUrl, accepts };
}

function rowToWire(row: PaymentLinkRow, config: LeashApiConfig) {
  const view = buildDiscoveryView(config, row.network, {
    id: row.id,
    ownerAgent: row.ownerAgent,
    price: row.price,
    currency: row.currency,
    acceptsCurrencies: row.acceptsCurrencies,
  });
  return {
    id: row.id,
    network: row.network,
    label: row.label,
    description: row.description,
    owner_agent: row.ownerAgent,
    owner_wallet: row.ownerWallet,
    pay_to: view.pay_to,
    method: row.method,
    path: row.path,
    price: row.price,
    currency: row.currency,
    accepts_currencies: row.acceptsCurrencies,
    response: row.response,
    webhook_url: row.webhookUrl,
    wrap_receipt: row.wrapReceipt,
    metadata: row.metadata,
    facilitator: view.facilitator,
    share_url: view.share_url,
    accepts: view.accepts,
    counters: {
      call_count: row.callCount,
      settled_count: row.settledCount,
      last_called_at: row.lastCalledAt,
      last_settled_at: row.lastSettledAt,
      last_tx_sig: row.lastTxSig,
      last_settled_amount_atomic: row.lastSettledAmountAtomic,
      last_settled_currency: row.lastSettledCurrency,
    },
    disabled_at: row.disabledAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function tryWatchAgent(
  deps: PaymentLinkRoutesDeps,
  network: 'solana-devnet' | 'solana-mainnet',
  ownerAgent: string,
): Promise<void> {
  try {
    const umi = umiReadOnly(deps.config, network);
    const [treasury] = findAssetSignerPda(umi, { asset: publicKey(ownerAgent) });
    await ensureWatched(deps.db, {
      network,
      agentAsset: ownerAgent,
      treasuryAddress: String(treasury),
    });
  } catch {
    /* watchlist add is best-effort */
  }
}

function generateSlug(): string {
  // ULID is 26 chars of [0-9A-Z]; lowercase to match `EndpointIdSchema`'s
  // `[a-z0-9-]+` regex. ULIDs are time-ordered → lex-sorted slugs are
  // also creation-ordered, which is convenient for cursors.
  return ulid().toLowerCase();
}

function uniq<T>(arr: ReadonlyArray<T>): T[] {
  return Array.from(new Set(arr));
}
