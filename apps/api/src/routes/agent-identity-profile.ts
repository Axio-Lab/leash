import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { ulid } from 'ulid';

import { adminAuth } from '../auth/admin.js';
import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import {
  createAgentIdentityClaim,
  getAgentIdentityClaim,
  getAgentIdentityDomain,
  getAgentIdentityProfile,
  getAgentIdentityProfileByHandle,
  listAgentIdentityClaims,
  listAgentIdentityDomains,
  revokeAgentIdentityClaim,
  upsertAgentIdentityDomain,
  upsertAgentIdentityProfile,
  type IdentityCapabilityCard,
} from '../storage/agent-identity.js';
import { getPlatformAgent } from '../storage/platform-agents.js';
import type { CacheClient } from '../storage/redis.js';
import { execute, type DbClient } from '../storage/turso.js';
import { conflict, invalidRequest, notFound } from '../util/errors.js';
import type { SvmNetwork } from '../util/network.js';

export type AgentIdentityProfileDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
  fetchImpl?: typeof globalThis.fetch;
};

const HandleSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'handle must start with a letter/number');

const CapabilityCardSchema = z
  .object({
    id: z.string().min(1).optional(),
    kind: z.enum([
      'seller_api',
      'buyer_tool',
      'data_source',
      'control_channel',
      'automation',
      'marketplace',
      'pay_skills',
      'custom',
    ]),
    title: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    source: z.enum(['leash', 'pay-skills', 'manual', 'connection', 'automation']).optional(),
    slug: z.string().max(200).optional(),
    endpoint: z.string().url().max(800).optional(),
    tags: z.array(z.string().min(1).max(40)).default([]),
    protocols: z.array(z.enum(['x402', 'mpp'])).default([]),
    visibility: z.enum(['public', 'private']).default('public'),
  })
  .openapi('IdentityCapabilityCard');

const ClaimSchema = z
  .object({
    id: z.string(),
    issuer: z.string(),
    subject_mint: PubkeySchema,
    type: z.string(),
    value: z.string(),
    evidence_url: z.string().nullable(),
    signature: z.string(),
    visibility: z.enum(['public', 'private']),
    expires_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('IdentityClaim');

const PublicIdentityProfileSchema = z
  .object({
    mint: PubkeySchema,
    network: NetworkSchema,
    handle: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    image_url: z.string().nullable(),
    treasury: PubkeySchema,
    services: z.array(z.object({ name: z.string(), endpoint: z.string() })),
    verified_domains: z.array(z.string()),
    capability_cards: z.array(CapabilityCardSchema),
    claims: z.array(ClaimSchema),
    operator_history: z.array(z.unknown()),
    reputation: z.object({
      settled_calls: z.number().int(),
      denied_calls: z.number().int(),
      rating: z.number(),
    }),
  })
  .openapi('PublicAgentIdentityProfile');

const VerifyResponseSchema = z
  .object({
    verified: z.boolean(),
    resolved_mint: PubkeySchema.nullable(),
    network: NetworkSchema.nullable(),
    checks: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })),
  })
  .openapi('AgentIdentityVerifyResponse');

function normalizeHandle(input: string): string {
  const handle = input.trim().replace(/^@+/, '').toLowerCase();
  const parsed = HandleSchema.safeParse(handle);
  if (!parsed.success) throw invalidRequest('invalid handle', parsed.error.flatten());
  return handle;
}

function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) throw invalidRequest('domain is required');
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (!url.hostname || url.hostname.includes('_')) throw new Error('bad hostname');
    return url.hostname;
  } catch {
    throw invalidRequest('invalid domain');
  }
}

function cardToWire(card: IdentityCapabilityCard) {
  return {
    id: card.id,
    kind: card.kind,
    title: card.title,
    ...(card.description ? { description: card.description } : {}),
    ...(card.source ? { source: card.source } : {}),
    ...(card.slug ? { slug: card.slug } : {}),
    ...(card.endpoint ? { endpoint: card.endpoint } : {}),
    tags: card.tags,
    protocols: card.protocols,
    visibility: card.visibility,
  };
}

async function reputationSummary(db: DbClient, mint: string, network: SvmNetwork) {
  const res = await execute(db, `SELECT decision FROM receipts WHERE network = ? AND agent = ?`, [
    network,
    mint,
  ]);
  let settled = 0;
  let denied = 0;
  for (const row of res.rows) {
    if (String(row.decision) === 'allow') settled += 1;
    else denied += 1;
  }
  const total = settled + denied;
  const disputeRate = total === 0 ? 0 : denied / total;
  const weight = Math.min(1, Math.log10(settled + 1) / 3);
  return {
    settled_calls: settled,
    denied_calls: denied,
    rating: Number(((1 - disputeRate) * weight).toFixed(4)),
  };
}

async function publicProfile(db: DbClient, mint: string) {
  const agent = await getPlatformAgent(db, mint);
  if (!agent) throw notFound('agent identity not found');
  const [profile, domains, claims, reputation] = await Promise.all([
    getAgentIdentityProfile(db, mint),
    listAgentIdentityDomains(db, mint),
    listAgentIdentityClaims(db, mint),
    reputationSummary(db, mint, agent.network),
  ]);
  const now = Date.now();
  return {
    mint: agent.mint,
    network: agent.network,
    handle: profile?.handle ?? null,
    name: agent.name,
    description: agent.description,
    image_url: agent.imageUrl,
    treasury: agent.treasury,
    services: agent.services,
    verified_domains: domains.filter((d) => d.status === 'verified').map((d) => d.domain),
    capability_cards: (profile?.capabilityCards ?? [])
      .filter((card) => card.visibility === 'public')
      .map(cardToWire),
    claims: claims
      .filter((claim) => {
        if (claim.visibility !== 'public' || claim.revokedAt) return false;
        if (claim.expiresAt && Date.parse(claim.expiresAt) <= now) return false;
        return true;
      })
      .map((claim) => ({
        id: claim.id,
        issuer: claim.issuer,
        subject_mint: claim.subjectMint,
        type: claim.type,
        value: claim.value,
        evidence_url: claim.evidenceUrl,
        signature: claim.signature,
        visibility: claim.visibility,
        expires_at: claim.expiresAt,
        revoked_at: claim.revokedAt,
        created_at: claim.createdAt,
      })),
    operator_history: [],
    reputation,
  };
}

async function resolveMint(
  db: DbClient,
  query: { mint?: string; handle?: string; domain?: string },
) {
  const selectors = [query.mint, query.handle, query.domain].filter(Boolean);
  if (selectors.length !== 1) {
    throw invalidRequest('provide exactly one of: mint, handle, domain');
  }
  if (query.mint) return query.mint;
  if (query.handle) {
    const profile = await getAgentIdentityProfileByHandle(db, normalizeHandle(query.handle));
    if (!profile) throw notFound('handle not found');
    return profile.agentMint;
  }
  const domain = await getAgentIdentityDomain(db, normalizeDomain(query.domain!));
  if (!domain || domain.status !== 'verified') throw notFound('verified domain not found');
  return domain.agentMint;
}

async function verifyDomainWellKnown(args: {
  fetchImpl: typeof globalThis.fetch;
  domain: string;
  mint: string;
  network: SvmNetwork;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await args.fetchImpl(`https://${args.domain}/.well-known/leash-agent.json`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `well-known returned HTTP ${res.status}` };
    const json = (await res.json()) as { mint?: unknown; network?: unknown };
    if (json.mint !== args.mint) return { ok: false, error: 'well-known mint mismatch' };
    if (json.network != null && json.network !== args.network) {
      return { ok: false, error: 'well-known network mismatch' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function normalizeCards(
  cards: Array<z.infer<typeof CapabilityCardSchema>>,
): IdentityCapabilityCard[] {
  return cards.map((card) => ({
    id: card.id ?? ulid(),
    kind: card.kind,
    title: card.title,
    ...(card.description ? { description: card.description } : {}),
    ...(card.source ? { source: card.source } : {}),
    ...(card.slug ? { slug: card.slug } : {}),
    ...(card.endpoint ? { endpoint: card.endpoint } : {}),
    tags: card.tags,
    protocols: card.protocols,
    visibility: card.visibility,
  }));
}

export function buildAgentIdentityProfileRoutes(deps: AgentIdentityProfileDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  app.use('/v1/platform/*', adminAuth(deps.config.adminSecret));

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/identity/resolve',
      tags: ['identity'],
      summary: 'Resolve an agent identity by mint, handle, or verified domain.',
      request: {
        query: z.object({
          mint: PubkeySchema.optional(),
          handle: z.string().optional(),
          domain: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PublicIdentityProfileSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const mint = await resolveMint(deps.db, c.req.valid('query'));
      return c.json(await publicProfile(deps.db, mint), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/identity/verify',
      tags: ['identity'],
      summary: 'Verify that an identity selector resolves to a live agent.',
      request: {
        query: z.object({
          mint: PubkeySchema.optional(),
          handle: z.string().optional(),
          domain: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: VerifyResponseSchema } },
        },
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      try {
        const mint = await resolveMint(deps.db, query);
        const agent = await getPlatformAgent(deps.db, mint);
        return c.json(
          {
            verified: agent != null,
            resolved_mint: agent?.mint ?? null,
            network: agent?.network ?? null,
            checks: [
              {
                name: 'selector_resolves',
                passed: true,
                detail: 'selector resolved to an agent mint',
              },
              {
                name: 'agent_exists',
                passed: agent != null,
                detail: agent ? 'platform agent is active or recorded' : 'agent row not found',
              },
            ],
          },
          200,
        );
      } catch (err) {
        return c.json(
          {
            verified: false,
            resolved_mint: null,
            network: null,
            checks: [
              {
                name: 'selector_resolves',
                passed: false,
                detail: err instanceof Error ? err.message : 'selector did not resolve',
              },
            ],
          },
          200,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/identity/{mint}',
      tags: ['identity'],
      summary: 'Fetch the public identity profile for an agent mint.',
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PublicIdentityProfileSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => c.json(await publicProfile(deps.db, c.req.valid('param').mint), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/platform/agents/{mint}/identity',
      tags: ['platform', 'identity'],
      summary: 'Update handle, visibility, and capability cards for an agent identity.',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                handle: z.string().nullable().optional(),
                visibility: z.record(z.unknown()).optional(),
                capability_cards: z.array(CapabilityCardSchema).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PublicIdentityProfileSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        409: {
          description: 'conflict',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      try {
        await upsertAgentIdentityProfile(deps.db, {
          agentMint: mint,
          network: agent.network,
          ...(body.handle !== undefined
            ? { handle: body.handle == null ? null : normalizeHandle(body.handle) }
            : {}),
          ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
          ...(body.capability_cards !== undefined
            ? { capabilityCards: normalizeCards(body.capability_cards) }
            : {}),
        });
      } catch (err) {
        if ((err as Error).message.toLowerCase().includes('unique')) {
          throw conflict('handle is already claimed');
        }
        throw err;
      }
      return c.json(await publicProfile(deps.db, mint), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/platform/agents/{mint}/identity/domains/verify',
      tags: ['platform', 'identity'],
      summary: 'Verify a domain by reading /.well-known/leash-agent.json.',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: { 'application/json': { schema: z.object({ domain: z.string().min(1) }) } },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({ domain: z.string(), status: z.literal('verified') }),
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
      const { mint } = c.req.valid('param');
      const { domain: rawDomain } = c.req.valid('json');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      const domain = normalizeDomain(rawDomain);
      const result = await verifyDomainWellKnown({
        fetchImpl: deps.fetchImpl ?? globalThis.fetch,
        domain,
        mint,
        network: agent.network,
      });
      if (!result.ok) {
        await upsertAgentIdentityDomain(deps.db, {
          domain,
          agentMint: mint,
          network: agent.network,
          status: 'failed',
          lastError: result.error,
        });
        throw invalidRequest(result.error);
      }
      await upsertAgentIdentityDomain(deps.db, {
        domain,
        agentMint: mint,
        network: agent.network,
        status: 'verified',
        verifiedAt: new Date().toISOString(),
        lastError: null,
      });
      return c.json({ domain, status: 'verified' as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/platform/agents/{mint}/identity/claims',
      tags: ['platform', 'identity'],
      summary: 'Attach a signed claim to an agent identity.',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                issuer: z.string().min(1).max(200),
                subject_mint: PubkeySchema.optional(),
                type: z.string().min(1).max(120),
                value: z.string().min(1).max(2000),
                evidence_url: z.string().url().max(800).optional().nullable(),
                signature: z.string().min(16).max(5000),
                visibility: z.enum(['public', 'private']).default('public'),
                expires_at: z.string().optional().nullable(),
              }),
            },
          },
        },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: ClaimSchema } } },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      const claim = await createAgentIdentityClaim(deps.db, {
        agentMint: mint,
        network: agent.network,
        issuer: body.issuer,
        subjectMint: body.subject_mint ?? mint,
        type: body.type,
        value: body.value,
        evidenceUrl: body.evidence_url ?? null,
        signature: body.signature,
        visibility: body.visibility,
        expiresAt: body.expires_at ?? null,
      });
      return c.json(
        {
          id: claim.id,
          issuer: claim.issuer,
          subject_mint: claim.subjectMint,
          type: claim.type,
          value: claim.value,
          evidence_url: claim.evidenceUrl,
          signature: claim.signature,
          visibility: claim.visibility,
          expires_at: claim.expiresAt,
          revoked_at: claim.revokedAt,
          created_at: claim.createdAt,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/platform/agents/{mint}/identity/claims/{id}',
      tags: ['platform', 'identity'],
      summary: 'Revoke a claim attached to an agent identity.',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ mint: PubkeySchema, id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint, id } = c.req.valid('param');
      const claim = await getAgentIdentityClaim(deps.db, id);
      if (!claim || claim.agentMint !== mint) throw notFound('claim not found');
      await revokeAgentIdentityClaim(deps.db, id);
      return c.json({ ok: true as const }, 200);
    },
  );

  return app;
}
