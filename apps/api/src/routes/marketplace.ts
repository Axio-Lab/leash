/**
 * `/v1/marketplace/*` — listings registry, ratings, reviews, health.
 *
 * Public endpoints (no auth):
 *   GET /v1/marketplace/listings           — browse approved listings
 *   GET /v1/marketplace/listings/{slug}    — listing detail + rating summary
 *
 * Admin-gated (Privy-bound via BFFs):
 *   POST   /v1/marketplace/listings              — create (status=pending)
 *   POST   /v1/marketplace/listings/from-url     — fetch+validate manifest
 *   PATCH  /v1/marketplace/listings/{id}/status  — approve/reject/disable
 *   POST   /v1/marketplace/listings/{id}/rating  — set rating
 *   POST   /v1/marketplace/listings/{id}/reviews — add review
 *   GET    /v1/marketplace/listings/{id}/reviews — list reviews
 *   POST   /v1/marketplace/listings/{id}/health  — record health probe result
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { adminAuth } from '../auth/admin.js';
import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, PubkeySchema } from '../openapi/common.js';
import {
  addListingReview,
  createListing,
  getListingById,
  getListingBySlug,
  getListingRatingSummary,
  listListingReviews,
  listListings,
  recordListingHealth,
  setListingRating,
  setListingStatus,
  type ListingPricing,
  type ListingStatus,
  type ListingTool,
} from '../storage/listings.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import { invalidRequest, notFound } from '../util/errors.js';
import { fetchAndValidateManifest, validateManifest } from '../util/mcp-manifest.js';

export type MarketplaceDeps = { config: LeashApiConfig; db: DbClient; cache: CacheClient };

const PricingSchema = z
  .object({
    type: z.enum(['free', 'per_call', 'variable']),
    amount: z.string().optional(),
    currency: z.string().optional(),
  })
  .openapi('ListingPricing');

const ToolSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.unknown().optional(),
  })
  .openapi('ListingTool');

const ListingStatusSchema = z.enum(['pending', 'approved', 'rejected', 'disabled']);

/** `pending` or `pending,approved,rejected` (comma / spaces). Invalid tokens dropped. */
const statusQuerySchema = z
  .string()
  .optional()
  .transform((raw): ListingStatus | ListingStatus[] | undefined => {
    if (raw == null || raw.trim() === '') return undefined;
    const parts = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const valid: ListingStatus[] = [];
    for (const p of parts) {
      const r = ListingStatusSchema.safeParse(p);
      if (r.success) valid.push(r.data);
    }
    if (valid.length === 0) return undefined;
    return valid.length === 1 ? valid[0]! : valid;
  });

const ListingSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    owner_privy_id: z.string(),
    owner_wallet: PubkeySchema,
    endpoint: z.string().url(),
    pricing: PricingSchema,
    tools: z.array(ToolSchema),
    docs_url: z.string().nullable(),
    free_tier: z.number().int(),
    health_status: z.enum(['ok', 'warn', 'down']).nullable(),
    health_checked: z.string().nullable(),
    status: ListingStatusSchema,
    created_at: z.string(),
  })
  .openapi('MarketplaceListing');

const RatingSummarySchema = z
  .object({ avg: z.number(), count: z.number().int() })
  .openapi('ListingRatingSummary');

const ReviewSchema = z
  .object({
    id: z.string(),
    listing_id: z.string(),
    privy_id: z.string(),
    body: z.string(),
    created_at: z.string(),
  })
  .openapi('ListingReview');

function listingToWire(l: NonNullable<Awaited<ReturnType<typeof getListingById>>>) {
  return {
    id: l.id,
    slug: l.slug,
    name: l.name,
    description: l.description,
    category: l.category,
    owner_privy_id: l.ownerPrivyId,
    owner_wallet: l.ownerWallet,
    endpoint: l.endpoint,
    pricing: l.pricing,
    tools: l.tools,
    docs_url: l.docsUrl,
    free_tier: l.freeTier,
    health_status: l.healthStatus,
    health_checked: l.healthCheckedAt,
    status: l.status,
    created_at: l.createdAt,
  };
}

export function buildMarketplaceRoutes(deps: MarketplaceDeps): OpenAPIHono {
  const app = new OpenAPIHono();

  // Admin gate ONLY for mutating + reviewing endpoints; browse stays public.
  app.use('/v1/marketplace/listings/from-url', adminAuth(deps.config.adminSecret));
  app.use('/v1/marketplace/listings', async (c, next) => {
    if (c.req.method === 'POST') {
      return adminAuth(deps.config.adminSecret)(c, next);
    }
    return next();
  });
  app.use('/v1/marketplace/listings/:id/status', adminAuth(deps.config.adminSecret));
  app.use('/v1/marketplace/listings/:id/rating', adminAuth(deps.config.adminSecret));
  app.use('/v1/marketplace/listings/:id/reviews', async (c, next) => {
    if (c.req.method === 'POST') return adminAuth(deps.config.adminSecret)(c, next);
    return next();
  });
  app.use('/v1/marketplace/listings/:id/health', adminAuth(deps.config.adminSecret));

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/marketplace/listings',
      tags: ['marketplace'],
      summary: 'Browse listings (defaults to status=approved)',
      request: {
        query: z.object({
          status: statusQuerySchema,
          category: z.string().optional(),
          owner_privy_id: z.string().optional(),
          q: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': { schema: z.object({ items: z.array(ListingSchema) }) },
          },
        },
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const items = await listListings(deps.db, {
        status: q.status ?? 'approved',
        ...(q.category ? { category: q.category } : {}),
        ...(q.owner_privy_id ? { ownerPrivyId: q.owner_privy_id } : {}),
        ...(q.q ? { q: q.q } : {}),
        ...(q.limit ? { limit: q.limit } : {}),
      });
      return c.json({ items: items.map(listingToWire) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/marketplace/listings/{slug}',
      tags: ['marketplace'],
      summary: 'Listing detail (with rating summary)',
      request: { params: z.object({ slug: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({ listing: ListingSchema, rating: RatingSummarySchema }),
            },
          },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid('param');
      const l = await getListingBySlug(deps.db, slug);
      if (!l) throw notFound('listing not found');
      const rating = await getListingRatingSummary(deps.db, l.id);
      return c.json({ listing: listingToWire(l), rating }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/marketplace/listings',
      tags: ['marketplace'],
      summary: 'Create a listing (status=pending)',
      security: [{ AdminSecret: [] }],
      request: {
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                slug: z
                  .string()
                  .min(2)
                  .max(80)
                  .regex(/^[a-z0-9-]+$/),
                name: z.string().min(1).max(120),
                description: z.string().min(1),
                category: z.string().min(1).max(40).default('misc'),
                owner_privy_id: z.string().min(1),
                owner_wallet: PubkeySchema,
                endpoint: z.string().url(),
                pricing: PricingSchema,
                tools: z.array(ToolSchema).min(1),
                docs_url: z.string().url().optional(),
                free_tier: z.number().int().nonnegative().optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: ListingSchema } } },
        409: {
          description: 'slug taken',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const b = c.req.valid('json');
      const existing = await getListingBySlug(deps.db, b.slug);
      if (existing) throw invalidRequest('slug already in use');
      const created = await createListing(deps.db, {
        slug: b.slug,
        name: b.name,
        description: b.description,
        category: b.category,
        ownerPrivyId: b.owner_privy_id,
        ownerWallet: b.owner_wallet,
        endpoint: b.endpoint,
        pricing: b.pricing as ListingPricing,
        tools: b.tools as ListingTool[],
        ...(b.docs_url ? { docsUrl: b.docs_url } : {}),
        ...(b.free_tier !== undefined ? { freeTier: b.free_tier } : {}),
      });
      return c.json(listingToWire(created), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/marketplace/listings/from-url',
      tags: ['marketplace'],
      summary: 'Fetch and validate a /.well-known/leash-mcp.json manifest',
      security: [{ AdminSecret: [] }],
      request: {
        body: {
          required: true,
          content: {
            'application/json': { schema: z.object({ url: z.string().url() }) },
          },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({
                manifest: z.object({
                  name: z.string(),
                  slug: z.string().nullable(),
                  description: z.string(),
                  category: z.string(),
                  endpoint: z.string(),
                  tools: z.array(ToolSchema),
                  pricing: PricingSchema,
                  docs_url: z.string().optional(),
                  free_tier: z.number().int().optional(),
                }),
              }),
            },
          },
        },
        422: {
          description: 'invalid',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { url } = c.req.valid('json');
      const manifest = await fetchAndValidateManifest(url);
      return c.json({ manifest }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/marketplace/listings/{id}/status',
      tags: ['marketplace'],
      summary: 'Set listing status (approve/reject/disable)',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
        body: {
          required: true,
          content: {
            'application/json': { schema: z.object({ status: ListingStatusSchema }) },
          },
        },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: ListingSchema } } },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { status } = c.req.valid('json');
      const existing = await getListingById(deps.db, id);
      if (!existing) throw notFound('listing not found');
      await setListingStatus(deps.db, id, status);
      const after = await getListingById(deps.db, id);
      return c.json(listingToWire(after!), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/marketplace/listings/{id}/rating',
      tags: ['marketplace'],
      summary: 'Set the signed-in user rating for a listing',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                privy_id: z.string().min(1),
                stars: z.number().int().min(1).max(5),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: RatingSummarySchema } },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { privy_id, stars } = c.req.valid('json');
      const existing = await getListingById(deps.db, id);
      if (!existing) throw notFound('listing not found');
      await setListingRating(deps.db, { listingId: id, privyId: privy_id, stars });
      const summary = await getListingRatingSummary(deps.db, id);
      return c.json(summary, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/marketplace/listings/{id}/reviews',
      tags: ['marketplace'],
      summary: 'Add a written review for a listing',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                privy_id: z.string().min(1),
                body: z.string().min(1).max(2000),
              }),
            },
          },
        },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: ReviewSchema } } },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { privy_id, body } = c.req.valid('json');
      const existing = await getListingById(deps.db, id);
      if (!existing) throw notFound('listing not found');
      const review = await addListingReview(deps.db, {
        listingId: id,
        privyId: privy_id,
        body,
      });
      return c.json(
        {
          id: review.id,
          listing_id: review.listingId,
          privy_id: review.privyId,
          body: review.body,
          created_at: review.createdAt,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/marketplace/listings/{id}/reviews',
      tags: ['marketplace'],
      summary: 'List reviews for a listing',
      request: {
        params: z.object({ id: z.string().min(1) }),
        query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': { schema: z.object({ items: z.array(ReviewSchema) }) },
          },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { limit } = c.req.valid('query');
      const items = await listListingReviews(deps.db, id, limit ?? 50);
      return c.json(
        {
          items: items.map((r) => ({
            id: r.id,
            listing_id: r.listingId,
            privy_id: r.privyId,
            body: r.body,
            created_at: r.createdAt,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/marketplace/listings/{id}/health',
      tags: ['marketplace'],
      summary: 'Record a health probe outcome',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({ status: z.enum(['ok', 'warn', 'down']) }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { status } = c.req.valid('json');
      const existing = await getListingById(deps.db, id);
      if (!existing) throw notFound('listing not found');
      await recordListingHealth(deps.db, id, status);
      return c.json({ ok: true as const }, 200);
    },
  );

  return app;
}

// Re-export validateManifest so callers (e.g. seed scripts, future
// background workers) can validate without going through HTTP.
export { validateManifest };
