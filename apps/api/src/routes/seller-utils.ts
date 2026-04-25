/**
 * Seller-kit utility endpoints.
 *
 * These are the small "introspection + helpers" surfaces that
 * `@leash/seller-kit` exposes as plain TypeScript exports
 * (`KNOWN_TOKENS`, `KNOWN_STABLE_SYMBOLS`, `defaultFacilitatorFor`,
 * `parsePrice`, `resolveSellerPayTo`). API consumers — including
 * polyglot SDKs that don't have access to the JS package — need an
 * HTTP equivalent so they can:
 *
 *   - render currency dropdowns scoped to the network they're on
 *     (`GET /v1/seller/networks`)
 *   - know which facilitator a payment link will settle through
 *     before they create it (`GET /v1/seller/facilitator`)
 *   - validate a draft `price` string against the same parser the
 *     paywall will use at advertise time (`POST /v1/seller/parse-price`)
 *   - derive the on-chain `payTo` for an agent without owning a Solana
 *     RPC client themselves (`GET /v1/agents/{mint}/pay-to`)
 *
 * All four endpoints are network-scoped via the caller's API key and
 * read-only. None of them mutate DB state.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import {
  KNOWN_STABLE_SYMBOLS,
  KNOWN_TOKENS,
  defaultFacilitatorFor,
  type KnownStableSymbol,
  type TokenNetwork,
} from '@leash/core';
import { parsePrice } from '@leash/seller-kit';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { umiReadOnly } from '../util/umi.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { invalidRequest } from '../util/errors.js';
import { networkToCaip2 } from '../util/network.js';

const StableSchema = z.enum(
  KNOWN_STABLE_SYMBOLS as readonly [KnownStableSymbol, ...KnownStableSymbol[]],
);

const TokenInfoSchema = z
  .object({
    mint: PubkeySchema,
    symbol: z.string(),
    name: z.string(),
    decimals: z.number().int().min(0).max(255),
    program: z.enum(['spl-token', 'spl-token-2022']),
    stable: z.boolean(),
  })
  .openapi('SellerTokenInfo');

const SellerNetworkInfoSchema = z
  .object({
    network: NetworkSchema,
    caip2: z.string(),
    facilitator: z.string().url(),
    accepts: z.array(StableSchema),
    tokens: z.array(TokenInfoSchema),
  })
  .openapi('SellerNetworkInfo');

const SellerNetworksResponseSchema = z
  .object({
    items: z.array(SellerNetworkInfoSchema),
    /** The caller's currently-scoped network. */
    current: SellerNetworkInfoSchema,
  })
  .openapi('SellerNetworksResponse');

const SellerFacilitatorResponseSchema = z
  .object({
    network: NetworkSchema,
    facilitator: z.string().url(),
    /**
     * `'config'` when the API operator pinned `LEASH_API_FACILITATOR_URL`,
     * `'default'` when we fell back to the per-network public default.
     */
    source: z.enum(['config', 'default']),
  })
  .openapi('SellerFacilitatorResponse');

const ParsePriceBody = z
  .object({
    price: z.string().min(1).openapi({ example: '$0.001' }),
    currency: StableSchema.optional().openapi({
      description: 'Default currency to use for `$x` / bare numeric strings. Defaults to USDC.',
    }),
  })
  .openapi('ParsePriceBody');

const ParsePriceResponseSchema = z
  .object({
    /** Atomic integer for the resolved currency on the caller network. */
    amount: z.string(),
    currency: StableSchema,
    asset: PubkeySchema,
    network: NetworkSchema,
    /**
     * Equivalent units for every other accepted stablecoin on the same
     * network — handy for showing a "$0.001 ≈ 1000 USDC ≈ 1000 USDT"
     * preview without re-calling the endpoint per currency.
     */
    equivalents: z.array(
      z.object({
        currency: StableSchema,
        amount: z.string(),
        asset: PubkeySchema,
      }),
    ),
  })
  .openapi('ParsePriceResponse');

const PayToResponseSchema = z
  .object({
    agent_asset: PubkeySchema,
    network: NetworkSchema,
    /** Asset Signer PDA — the on-chain `payTo` the seller-kit advertises. */
    pay_to: PubkeySchema,
  })
  .openapi('PayToResponse');

export type SellerUtilsRoutesDeps = {
  config: LeashApiConfig;
  db: DbClient;
};

export function buildSellerUtilsRoutes(
  deps: SellerUtilsRoutesDeps,
): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  // -----------------------------------------------------------------
  // GET /v1/seller/networks
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/seller/networks',
      tags: ['seller-utils'],
      summary: 'Enumerate every settlement network + accepted stablecoin set.',
      responses: {
        200: {
          description: 'Network catalog with the caller-scoped network surfaced as `current`.',
          content: { 'application/json': { schema: SellerNetworksResponseSchema } },
        },
      },
    }),
    async (c) => {
      const items = (['solana-devnet', 'solana-mainnet'] as const).map((n) =>
        buildNetworkInfo(deps.config, n),
      );
      const current = items.find((i) => i.network === c.var.network) ?? items[0];
      return c.json({ items, current }, 200);
    },
  );

  // -----------------------------------------------------------------
  // GET /v1/seller/facilitator
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/seller/facilitator',
      tags: ['seller-utils'],
      summary: 'Resolve the facilitator URL the caller-scoped network settles through.',
      responses: {
        200: {
          description: 'Facilitator URL + provenance (config vs default).',
          content: { 'application/json': { schema: SellerFacilitatorResponseSchema } },
        },
      },
    }),
    async (c) => {
      const network = c.var.network;
      const configured = deps.config.facilitatorUrl?.trim();
      const facilitator =
        configured && configured.length > 0 ? configured : defaultFacilitatorFor([network]);
      const source: 'config' | 'default' =
        configured && configured.length > 0 ? 'config' : 'default';
      return c.json({ network, facilitator, source }, 200);
    },
  );

  // -----------------------------------------------------------------
  // POST /v1/seller/parse-price
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/seller/parse-price',
      tags: ['seller-utils'],
      summary: 'Parse a `price` string into atomic units + show equivalents.',
      request: {
        body: { required: true, content: { 'application/json': { schema: ParsePriceBody } } },
      },
      responses: {
        200: {
          description: 'Parsed price + per-stablecoin equivalents.',
          content: { 'application/json': { schema: ParsePriceResponseSchema } },
        },
        422: {
          description: 'Could not parse the `price` for the given currency on this network.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network = c.var.network;
      const tokenNetwork: TokenNetwork = network === 'solana-devnet' ? 'devnet' : 'mainnet';
      const currency: KnownStableSymbol = body.currency ?? 'USDC';
      const parsed = parsePrice(body.price, { network: tokenNetwork, defaultCurrency: currency });
      if (!parsed || !parsed.asset) {
        throw invalidRequest(
          `unparseable price "${body.price}" for currency ${currency} on ${network} ` +
            `(supported: ${KNOWN_STABLE_SYMBOLS.join(', ')})`,
        );
      }
      const equivalents = KNOWN_STABLE_SYMBOLS.filter((sym) => sym !== currency).flatMap((sym) => {
        const eq = parsePrice(body.price, { network: tokenNetwork, defaultCurrency: sym });
        return eq && eq.asset ? [{ currency: sym, amount: eq.amount, asset: eq.asset }] : [];
      });
      return c.json(
        {
          amount: parsed.amount,
          currency,
          asset: parsed.asset,
          network,
          equivalents,
        },
        200,
      );
    },
  );

  // -----------------------------------------------------------------
  // GET /v1/agents/{mint}/pay-to
  // -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agents/{mint}/pay-to',
      tags: ['seller-utils', 'agents'],
      summary: 'Resolve the on-chain `payTo` (Asset Signer PDA) for an agent.',
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'Asset Signer PDA on the caller-scoped network.',
          content: { 'application/json': { schema: PayToResponseSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const network = c.var.network;
      const umi = umiReadOnly(deps.config, network);
      const [payTo] = findAssetSignerPda(umi, { asset: publicKey(mint) });
      return c.json({ agent_asset: mint, network, pay_to: String(payTo) }, 200);
    },
  );

  return app;
}

function buildNetworkInfo(config: LeashApiConfig, network: 'solana-devnet' | 'solana-mainnet') {
  const tokenNetwork: TokenNetwork = network === 'solana-devnet' ? 'devnet' : 'mainnet';
  const configured = config.facilitatorUrl?.trim();
  // Per-network facilitator: prefer the explicit override (so docs +
  // CLIs see exactly what the paywall will use), fall back to the
  // public default for that cluster.
  const facilitator =
    configured && configured.length > 0 ? configured : defaultFacilitatorFor([network]);
  return {
    network,
    caip2: networkToCaip2(network),
    facilitator,
    accepts: [...KNOWN_STABLE_SYMBOLS],
    tokens: KNOWN_TOKENS[tokenNetwork].map((t) => ({
      mint: t.mint,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      program: t.program,
      stable: t.stable,
    })),
  };
}
