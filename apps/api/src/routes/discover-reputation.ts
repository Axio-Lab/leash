/**
 * Public agent-discovery + reputation endpoints.
 *
 * What lives here
 * ---------------
 *   GET /v1/discover                       — capability/price/reputation search
 *   GET /v1/agents/{mint}/reputation       — aggregate over the receipts table
 *
 * Why public (no API key required)
 * --------------------------------
 * Leash is the identity layer for AI agents, so discovery and
 * reputation reads must be public. They are the agent equivalent of
 * resolving a seller identity, checking its capabilities, and reading
 * proof before trusting or paying it.
 *
 * Both endpoints are read-only and rate-limited at the platform
 * edge; no PII is leaked because listings are user-published metadata
 * and receipts are already the audit trail Leash exposes via the
 * existing `/v1/receipts/*` API.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { LeashApiConfig } from '../config.js';
import { getPaySkillsProvider, searchPaySkills } from '../external/pay-skills.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { listListings } from '../storage/listings.js';
import type { CacheClient } from '../storage/redis.js';
import { execute } from '../storage/turso.js';
import type { DbClient } from '../storage/turso.js';
import { invalidRequest, notFound } from '../util/errors.js';
import type { SvmNetwork } from '../util/network.js';
import { publicIdentitySummary } from '../util/public-identity.js';

export type DiscoverReputationDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
};

const DiscoverItemSchema = z
  .object({
    source: z.enum(['leash', 'pay-skills']).openapi({
      description:
        'Catalogue this entry came from. `leash` items are agents listed on the Leash marketplace (carry seller_wallet + endpoints); `pay-skills` items are pulled from the Solana Foundation pay-skills registry (https://github.com/solana-foundation/pay-skills) and have no on-chain seller identity.',
    }),
    url: z.string().url(),
    title: z.string(),
    description: z.string(),
    slug: z.string().openapi({
      description:
        'Listing slug for Leash entries; provider FQN (e.g. "agentmail/email") for pay-skills entries.',
    }),
    category: z.string(),
    price_usdc: z.string().nullable().openapi({
      description: 'Decimal USDC price for `per_call` listings; null for free or variable.',
    }),
    pricing_type: z.enum(['free', 'per_call', 'variable']),
    seller_agent_mint: PubkeySchema.nullable(),
    seller_identity: z
      .object({
        mint: PubkeySchema,
        network: NetworkSchema,
        handle: z.string().nullable(),
        name: z.string(),
        verified_domains: z.array(z.string()),
        reputation: z.object({
          settled_calls: z.number().int(),
          denied_calls: z.number().int(),
          rating: z.number(),
        }),
        capability_cards_count: z.number().int(),
        claims_count: z.number().int(),
      })
      .nullable()
      .openapi({
        description:
          'Public seller identity summary for Leash-native listings. Null for legacy unlinked listings and pay-skills entries.',
      }),
    seller_wallet: PubkeySchema.nullable().openapi({
      description: 'Owner wallet for Leash listings; null for pay-skills entries.',
    }),
    rating: z.number().min(0).max(1).nullable().openapi({
      description:
        'Aggregated rating in `[0, 1]`. Currently derived from the listing rating + seller dispute rate; null when neither signal exists. Always null for pay-skills entries.',
    }),
    health_status: z.enum(['ok', 'warn', 'down']).nullable(),
    endpoint_count: z.number().int().min(0).optional().openapi({
      description:
        'Number of payable endpoints published by the provider when known. Most useful for pay-skills entries, where tools[] is intentionally empty until expanded.',
    }),
    tags: z.array(z.string()),
    tools: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
        }),
      )
      .openapi({
        description:
          'Tools the listing exposes. The MCP host advertises this so an LLM can pick the right call once a service is selected. Always empty for pay-skills entries (use `endpoint_count` and the provider OpenAPI doc).',
      }),
    endpoints: z
      .array(
        z.object({
          method: z.string(),
          url: z.string().url(),
          description: z.string(),
        }),
      )
      .optional(),
  })
  .openapi('DiscoverItem');

const DiscoverResponseSchema = z
  .object({
    items: z.array(DiscoverItemSchema),
    next_cursor: z.string().nullable(),
  })
  .openapi('DiscoverResponse');

const PaySkillsEndpointSchema = z
  .object({
    method: z.string(),
    path: z.string().openapi({
      description: 'Endpoint path relative to `service_url`.',
    }),
    url: z.string().url().openapi({
      description:
        'Absolute URL — `service_url` joined with `path`. Pay this directly with `leash_pay_payment_link` / `buyer.fetch()`; the gateway returns 402 with the x402 challenge.',
    }),
    description: z.string().optional(),
    resource: z.string().optional(),
    pricing: z
      .object({
        mode: z.string().optional(),
        dimensions: z
          .array(
            z.object({
              direction: z.string().optional(),
              scale: z.number().optional(),
              unit: z.string().optional(),
              tiers: z
                .array(
                  z.object({
                    price_usd: z.number().optional(),
                    threshold: z.number().optional(),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
      })
      .nullable()
      .optional(),
    protocol: z.array(z.string()).optional().openapi({
      description:
        'Payment protocols the endpoint supports — typically `["x402"]`; dual-protocol sellers may include `"mpp"`.',
    }),
    supported_usd: z.array(z.string()).optional().openapi({
      description: 'Stablecoin symbols the seller accepts (e.g. `["USDC"]`, `["USDC","USDT"]`).',
    }),
    probe_status: z.string().optional().openapi({
      description:
        'pay-skills publishes a probe result per endpoint. `ok` means a recent live request returned the expected challenge; treat anything else as caution.',
    }),
    probe_description: z.string().optional(),
  })
  .openapi('PaySkillsEndpoint');

const PaySkillsProviderResponseSchema = z
  .object({
    fqn: z.string(),
    title: z.string(),
    description: z.string(),
    use_case: z.string().optional(),
    category: z.string(),
    service_url: z.string().url(),
    version: z.string().optional(),
    endpoints: z.array(PaySkillsEndpointSchema),
  })
  .openapi('PaySkillsProvider');

const ReputationResponseSchema = z
  .object({
    agent_mint: PubkeySchema,
    network: NetworkSchema,
    total_volume_usdc: z.string().openapi({
      description: 'Sum of `price.amount` across allowed receipts, decoded by mint decimals.',
    }),
    settled_calls: z.number().int().min(0),
    denied_calls: z.number().int().min(0),
    distinct_counterparties: z.number().int().min(0).openapi({
      description:
        'Heuristic — distinct request-URL hosts the agent paid (buy-side) or served (sell-side).',
    }),
    dispute_rate: z.number().min(0).max(1),
    oldest_receipt_at: z.string().nullable(),
    newest_receipt_at: z.string().nullable(),
    rating: z.number().min(0).max(1).openapi({
      description:
        '`(1 - dispute_rate) * weight` where `weight = min(1, log10(settled_calls + 1) / 3)`. Tunable.',
    }),
  })
  .openapi('AgentReputation');

export function buildDiscoverReputationRoutes(deps: DiscoverReputationDeps): OpenAPIHono {
  const app = new OpenAPIHono();

  // ────────────────────────────────────────────────────────────────
  // GET /v1/discover
  // ────────────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/discover',
      tags: ['discover'],
      summary: 'Search the agent marketplace by capability, price, and reputation.',
      description:
        'Returns paid services from two catalogues, merged into one list with a per-item `source` tag: (1) approved Leash marketplace listings (filterable by capability, price), and (2) the Solana Foundation `pay-skills` provider catalogue (https://github.com/solana-foundation/pay-skills) — the same registry the pay.sh CLI reads. Both sources are filterable by capability (substring match against title / description / category / use_case) and by an optional `max_price_usdc` ceiling. Use `source=leash` or `source=pay-skills` to scope to a single catalogue.',
      request: {
        query: z.object({
          capability: z.string().min(1).optional().openapi({
            description: 'Free-text capability label (e.g. "ocr", "weather", "image-generation").',
          }),
          max_price_usdc: z
            .string()
            .regex(/^\d+(\.\d+)?$/)
            .optional()
            .openapi({
              description:
                'Maximum decimal USDC price per call. Listings priced strictly above this value are filtered out. Free + variable-priced listings are always included unless `pricing_type=per_call` is also set.',
            }),
          pricing_type: z.enum(['free', 'per_call', 'variable']).optional(),
          source: z.enum(['leash', 'pay-skills', 'all']).optional().openapi({
            description:
              'Which catalogue(s) to read. Defaults to `all` (Leash listings + pay-skills providers merged with a per-item `source` tag).',
          }),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
      },
      responses: {
        200: {
          description: 'Discover feed (newest approved listings first).',
          content: { 'application/json': { schema: DiscoverResponseSchema } },
        },
        400: {
          description: 'Bad query.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { capability, max_price_usdc, pricing_type, source, limit } = c.req.valid('query');

      const cap = max_price_usdc ? Number(max_price_usdc) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(cap)) throw invalidRequest('max_price_usdc must be a number');

      const wantLeash = source !== 'pay-skills';
      const wantPaySkills = source !== 'leash';
      // Pull each source up to its own `limit` so a small global
      // limit doesn't starve one catalogue. Final merge is capped
      // again below.
      const perSourceLimit = limit ?? 25;

      const [listings, paySkillsItems] = await Promise.all([
        wantLeash
          ? listListings(deps.db, {
              status: 'approved',
              ...(capability ? { q: capability } : {}),
              limit: perSourceLimit,
            })
          : Promise.resolve([] as Awaited<ReturnType<typeof listListings>>),
        wantPaySkills
          ? searchPaySkills({
              ...(capability ? { capability } : {}),
              ...(max_price_usdc ? { max_price_usdc: Number(max_price_usdc) } : {}),
              ...(pricing_type ? { pricing_type } : {}),
              limit: perSourceLimit,
            })
          : Promise.resolve([]),
      ]);

      const leashItems = await Promise.all(
        listings
          .filter((l) => {
            if (pricing_type && l.pricing.type !== pricing_type) return false;
            if (l.pricing.type === 'per_call') {
              const amt = Number(l.pricing.amount ?? '0');
              if (Number.isFinite(amt) && amt > cap) return false;
            }
            return true;
          })
          .map(async (l) => {
            const tags = l.category ? [l.category] : [];
            // Listing rating is owned by the marketplace tables; we
            // could surface it here, but pulling the per-listing rating
            // summary for every row would N+1 the query. The agent-
            // reputation endpoint covers per-agent quality; here we
            // expose the listing health as a coarse signal until we
            // denormalise listing.rating into the listings table.
            const rating: number | null =
              l.healthStatus === 'ok'
                ? 1
                : l.healthStatus === 'warn'
                  ? 0.6
                  : l.healthStatus === 'down'
                    ? 0
                    : null;
            const sellerIdentity = await publicIdentitySummary(deps.db, l.sellerAgentMint);
            return {
              source: 'leash' as const,
              url: l.endpoint,
              title: l.name,
              description: l.description,
              slug: l.slug,
              category: l.category,
              price_usdc: l.pricing.type === 'per_call' ? (l.pricing.amount ?? null) : null,
              pricing_type: l.pricing.type,
              seller_agent_mint: l.sellerAgentMint,
              seller_identity: sellerIdentity,
              seller_wallet: l.ownerWallet,
              rating,
              health_status: l.healthStatus,
              tags,
              endpoint_count: l.endpoints.length,
              tools: [],
              endpoints: l.endpoints.map((ep) => ({
                method: ep.method,
                url: ep.url,
                description: ep.description,
              })),
            };
          }),
      );

      // Merge with a stable preference: rated Leash listings first,
      // then unrated Leash, then pay-skills (sorted by min price
      // ascending so cheap free-tier APIs surface before metered ones).
      const sortedPaySkills = [...paySkillsItems].sort((a, b) => {
        const av = a.pricing_type === 'free' ? 0 : Number(a.price_usdc ?? Number.POSITIVE_INFINITY);
        const bv = b.pricing_type === 'free' ? 0 : Number(b.price_usdc ?? Number.POSITIVE_INFINITY);
        return av - bv;
      });
      const merged = [...leashItems, ...sortedPaySkills].slice(0, limit ?? 25);

      return c.json({ items: merged, next_cursor: null }, 200);
    },
  );

  // ────────────────────────────────────────────────────────────────
  // GET /v1/discover/pay-skills/{operator}/{name}
  // GET /v1/discover/pay-skills/{operator}/{origin}/{name}
  //
  // pay-skills FQNs are 2- or 3-segment paths (`google/translate`,
  // `coinbase-cdp/coinbase-developer-platform/baseSepoliaWalletApi`).
  // We expose the same shape as `pay skills endpoints <fqn>` so an
  // agent can do search → expand → pay without touching the
  // upstream catalogue directly.
  // ────────────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/discover/pay-skills/{op}/{a}/{b}',
      tags: ['discover'],
      summary: 'Expand a pay-skills provider into its paid endpoints (3-segment FQN).',
      description:
        'Companion to `/v1/discover` for pay-skills providers. Given a fully-qualified name from the catalogue (e.g. `agentmail/email`, `coinbase-cdp/coinbase-developer-platform/baseSepoliaWalletApi`), returns the published endpoint list with absolute URLs the agent can hand straight to `leash_pay_payment_link`. Mirrors `pay skills endpoints` from the pay.sh CLI but served through the same Leash origin used elsewhere — no extra client config.',
      request: {
        params: z.object({
          op: z.string().min(1),
          a: z.string().min(1),
          b: z.string().min(1).optional(),
        }),
      },
      responses: {
        200: {
          description: 'Provider endpoint list.',
          content: { 'application/json': { schema: PaySkillsProviderResponseSchema } },
        },
        404: {
          description: 'No such provider in the pay-skills catalogue.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { op, a, b } = c.req.valid('param');
      const fqn = b ? `${op}/${a}/${b}` : `${op}/${a}`;
      const provider = await getPaySkillsProvider({ fqn });
      if (!provider) throw notFound(`pay-skills provider not found: ${fqn}`);
      return c.json(
        {
          fqn: provider.fqn,
          title: provider.title,
          description: provider.description,
          ...(provider.use_case ? { use_case: provider.use_case } : {}),
          category: provider.category,
          service_url: provider.service_url,
          ...(provider.version ? { version: provider.version } : {}),
          endpoints: provider.endpoints.map((ep, i) => ({
            method: ep.method,
            path: ep.path,
            url: provider.endpoint_urls[i] ?? '',
            ...(ep.description ? { description: ep.description } : {}),
            ...(ep.resource ? { resource: ep.resource } : {}),
            ...(ep.pricing ? { pricing: ep.pricing } : {}),
            ...(ep.protocol ? { protocol: ep.protocol } : {}),
            ...(ep.supported_usd ? { supported_usd: ep.supported_usd } : {}),
            ...(ep.probe_status ? { probe_status: ep.probe_status } : {}),
            ...(ep.probe_description ? { probe_description: ep.probe_description } : {}),
          })),
        },
        200,
      );
    },
  );

  // 2-segment alias.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/discover/pay-skills/{op}/{a}',
      tags: ['discover'],
      summary: 'Expand a pay-skills provider into its paid endpoints (2-segment FQN).',
      description: 'Same as the 3-segment variant — see `/v1/discover/pay-skills/{op}/{a}/{b}`.',
      request: {
        params: z.object({
          op: z.string().min(1),
          a: z.string().min(1),
        }),
      },
      responses: {
        200: {
          description: 'Provider endpoint list.',
          content: { 'application/json': { schema: PaySkillsProviderResponseSchema } },
        },
        404: {
          description: 'No such provider.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { op, a } = c.req.valid('param');
      const fqn = `${op}/${a}`;
      const provider = await getPaySkillsProvider({ fqn });
      if (!provider) throw notFound(`pay-skills provider not found: ${fqn}`);
      return c.json(
        {
          fqn: provider.fqn,
          title: provider.title,
          description: provider.description,
          ...(provider.use_case ? { use_case: provider.use_case } : {}),
          category: provider.category,
          service_url: provider.service_url,
          ...(provider.version ? { version: provider.version } : {}),
          endpoints: provider.endpoints.map((ep, i) => ({
            method: ep.method,
            path: ep.path,
            url: provider.endpoint_urls[i] ?? '',
            ...(ep.description ? { description: ep.description } : {}),
            ...(ep.resource ? { resource: ep.resource } : {}),
            ...(ep.pricing ? { pricing: ep.pricing } : {}),
            ...(ep.protocol ? { protocol: ep.protocol } : {}),
            ...(ep.supported_usd ? { supported_usd: ep.supported_usd } : {}),
            ...(ep.probe_status ? { probe_status: ep.probe_status } : {}),
            ...(ep.probe_description ? { probe_description: ep.probe_description } : {}),
          })),
        },
        200,
      );
    },
  );

  // ────────────────────────────────────────────────────────────────
  // GET /v1/agents/{mint}/reputation
  // ────────────────────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agents/{mint}/reputation',
      tags: ['discover'],
      summary: 'Aggregate reputation snapshot for an agent.',
      description:
        'Computed live from the `receipts` table: settled-call volume, dispute rate, distinct counterparties (request-URL host heuristic), and a normalised `rating` in [0, 1]. Use this to vet a counterparty before transacting.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        query: z.object({
          network: NetworkSchema.optional().openapi({
            description: 'Defaults to `solana-devnet`. Reputation is network-scoped.',
          }),
        }),
      },
      responses: {
        200: {
          description: 'Reputation snapshot.',
          content: { 'application/json': { schema: ReputationResponseSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const network: SvmNetwork = c.req.valid('query').network ?? 'solana-devnet';

      // Pull the (small) raw receipt rows and aggregate in TS so we
      // can decode `price.amount` by mint decimals on the way through.
      // For agents with > 1k receipts we'll move to a materialised
      // view — this is cheap up to ~5k rows on Turso.
      const res = await execute(
        deps.db,
        `SELECT decision, raw_json, ingested_at
           FROM receipts
          WHERE network = ? AND agent = ?
          ORDER BY ingested_at ASC`,
        [network, mint],
      );

      let settled = 0;
      let denied = 0;
      let totalUsdcAtomic = 0n;
      const counterparties = new Set<string>();
      let oldest: string | null = null;
      let newest: string | null = null;

      for (const row of res.rows) {
        const decision = String(row.decision);
        const ingestedAt = String(row.ingested_at);
        if (oldest == null || ingestedAt < oldest) oldest = ingestedAt;
        if (newest == null || ingestedAt > newest) newest = ingestedAt;

        if (decision === 'allow') settled += 1;
        else denied += 1;

        let raw: {
          price?: { amount?: string; currency?: string; asset?: string };
          request?: { url?: string };
        } | null = null;
        try {
          raw = JSON.parse(String(row.raw_json ?? '{}'));
        } catch {
          raw = null;
        }
        if (!raw) continue;

        // Volume: only sum allowed (settled) USDC for now. USDG/USDT
        // can join once we have decimal-aware aggregation across
        // multiple stables. Atomic units assume 6-decimal USDC; we
        // verify by symbol.
        if (decision === 'allow' && raw.price?.amount && raw.price?.currency === 'USDC') {
          try {
            totalUsdcAtomic += BigInt(raw.price.amount);
          } catch {
            /* malformed amount — skip */
          }
        }

        const url = raw.request?.url;
        if (url) {
          try {
            counterparties.add(new URL(url).host);
          } catch {
            /* malformed URL — skip */
          }
        }
      }

      const total = settled + denied;
      const disputeRate = total === 0 ? 0 : denied / total;
      // log10(n+1) / 3 saturates at ~settled=999 (~1.0). Tweakable.
      const weight = Math.min(1, Math.log10(settled + 1) / 3);
      const rating = (1 - disputeRate) * weight;

      return c.json(
        {
          agent_mint: mint,
          network,
          total_volume_usdc: (Number(totalUsdcAtomic) / 1e6).toFixed(6),
          settled_calls: settled,
          denied_calls: denied,
          distinct_counterparties: counterparties.size,
          dispute_rate: Number(disputeRate.toFixed(4)),
          oldest_receipt_at: oldest,
          newest_receipt_at: newest,
          rating: Number(rating.toFixed(4)),
        },
        200,
      );
    },
  );

  return app;
}
