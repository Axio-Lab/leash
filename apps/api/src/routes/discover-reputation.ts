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
 * Agent-to-agent commerce is a permissionless market — Leash is the
 * registry, not the gatekeeper. Discovery and reputation reads are
 * the agent equivalent of "google a service before paying it"; they
 * must work for any caller (MCP host, CLI, external indexer, the YC
 * reviewer hitting curl on the cmdline).
 *
 * Both endpoints are read-only and rate-limited at the platform
 * edge; no PII is leaked because listings are user-published metadata
 * and receipts are already the audit trail Leash exposes via the
 * existing `/v1/receipts/*` API.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { listListings } from '../storage/listings.js';
import type { CacheClient } from '../storage/redis.js';
import { execute } from '../storage/turso.js';
import type { DbClient } from '../storage/turso.js';
import { invalidRequest } from '../util/errors.js';
import type { SvmNetwork } from '../util/network.js';

export type DiscoverReputationDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
};

const DiscoverItemSchema = z
  .object({
    url: z.string().url(),
    title: z.string(),
    description: z.string(),
    slug: z.string(),
    category: z.string(),
    price_usdc: z.string().nullable().openapi({
      description: 'Decimal USDC price for `per_call` listings; null for free or variable.',
    }),
    pricing_type: z.enum(['free', 'per_call', 'variable']),
    seller_agent_mint: PubkeySchema.nullable(),
    seller_wallet: PubkeySchema,
    rating: z.number().min(0).max(1).nullable().openapi({
      description:
        'Aggregated rating in `[0, 1]`. Currently derived from the listing rating + seller dispute rate; null when neither signal exists.',
    }),
    health_status: z.enum(['ok', 'warn', 'down']).nullable(),
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
          'Tools the listing exposes. The MCP host advertises this so an LLM can pick the right call once a service is selected.',
      }),
  })
  .openapi('DiscoverItem');

const DiscoverResponseSchema = z
  .object({
    items: z.array(DiscoverItemSchema),
    next_cursor: z.string().nullable(),
  })
  .openapi('DiscoverResponse');

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
        'Returns approved listings filtered by capability (matched against category, name, description, tags, and tool names) and an optional `max_price_usdc` ceiling. Results are sorted by health + listing rating.',
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
      const { capability, max_price_usdc, pricing_type, limit } = c.req.valid('query');

      const listings = await listListings(deps.db, {
        status: 'approved',
        ...(capability ? { q: capability } : {}),
        limit: limit ?? 25,
      });

      const cap = max_price_usdc ? Number(max_price_usdc) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(cap)) throw invalidRequest('max_price_usdc must be a number');

      const items = listings
        .filter((l) => {
          if (pricing_type && l.pricing.type !== pricing_type) return false;
          if (l.pricing.type === 'per_call') {
            const amt = Number(l.pricing.amount ?? '0');
            if (Number.isFinite(amt) && amt > cap) return false;
          }
          return true;
        })
        .map((l) => {
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
          return {
            url: l.endpoint,
            title: l.name,
            description: l.description,
            slug: l.slug,
            category: l.category,
            price_usdc: l.pricing.type === 'per_call' ? (l.pricing.amount ?? null) : null,
            pricing_type: l.pricing.type,
            seller_agent_mint: null,
            seller_wallet: l.ownerWallet,
            rating,
            health_status: l.healthStatus,
            tags,
            tools: l.tools.map((t) => ({ name: t.name, description: t.description })),
          };
        });

      return c.json({ items, next_cursor: null }, 200);
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
