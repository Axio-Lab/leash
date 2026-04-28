/**
 * `/v1/platform/agents` — admin-gated endpoints used by the
 * `agent.leash.market` BFF to record platform-side agent rows after the
 * MPL Core asset has been minted browser-side via Privy + Umi.
 *
 * Why admin-only: the BFF holds the platform admin secret. End users
 * authenticate to the BFF with Privy; the BFF translates the session
 * into authenticated calls here. Putting Privy verification inside
 * `apps/api` would couple the rails to the Privy SDK (see PLAN.md §1
 * decisions — option A "BFF").
 *
 * Endpoints:
 *   POST   /v1/platform/agents           — create platform row + service key
 *   GET    /v1/platform/agents/{mint}    — fetch one (without secrets)
 *   GET    /v1/platform/agents           — list by owner
 *   PATCH  /v1/platform/agents/{mint}    — update capabilities (add tools)
 *   DELETE /v1/platform/agents/{mint}    — soft-delete + revoke service key
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { adminAuth } from '../auth/admin.js';
import { markKeyRevoked } from '../auth/api-key.js';
import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { encryptSecret } from '@leash/platform-auth/encryption';
import {
  createPlatformAgent,
  disablePlatformAgent,
  getPlatformAgent,
  listPlatformAgentsForOwner,
  updatePlatformAgentCapabilities,
  type Capability,
} from '../storage/platform-agents.js';
import { createApiKey, disableApiKey } from '../storage/api-keys.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import { invalidRequest, notFound } from '../util/errors.js';

export type PlatformAgentDeps = { config: LeashApiConfig; db: DbClient; cache: CacheClient };

const CapabilitySchema = z
  .object({
    slug: z.string().nullable().openapi({
      description: 'Marketplace listing slug if installed from leash.market; null for direct adds.',
    }),
    endpoint: z.string().url(),
    tools: z.array(z.string()).default([]),
    paid: z.boolean().optional(),
  })
  .openapi('AgentCapability');

const BudgetSchema = z
  .object({
    per_action: z.string(),
    per_task: z.string(),
    per_day: z.string(),
  })
  .openapi('AgentBudget');

const CreatePlatformAgentBody = z
  .object({
    mint: PubkeySchema.openapi({ description: 'Asset pubkey returned by mintAndSubmitAgent.' }),
    treasury: PubkeySchema.openapi({ description: 'Asset Signer PDA derived from `mint`.' }),
    owner_privy_id: z.string().min(1),
    owner_wallet: PubkeySchema,
    name: z.string().min(1).max(120),
    network: NetworkSchema,
    model: z.string().min(1).max(120),
    system_prompt: z.string().min(1),
    capabilities: z.array(CapabilitySchema).default([]),
    budget: BudgetSchema,
    llm_provider: z.enum(['anthropic', 'openai']),
    llm_api_key: z.string().min(8).openapi({
      description:
        'User-supplied LLM provider key. Encrypted at rest via ENCRYPTION_KEY before storage; never logged.',
    }),
  })
  .openapi('CreatePlatformAgentBody');

const PlatformAgentSchema = z
  .object({
    mint: PubkeySchema,
    owner_privy_id: z.string(),
    owner_wallet: PubkeySchema,
    name: z.string(),
    network: NetworkSchema,
    model: z.string(),
    system_prompt: z.string(),
    capabilities: z.array(CapabilitySchema),
    budget: BudgetSchema,
    treasury: PubkeySchema,
    service_key_id: z.string(),
    llm_provider: z.enum(['anthropic', 'openai']),
    status: z.enum(['active', 'disabled']),
    created_at: z.string(),
  })
  .openapi('PlatformAgent');

function rowToWire(r: Awaited<ReturnType<typeof getPlatformAgent>>) {
  if (!r) return null;
  return {
    mint: r.mint,
    owner_privy_id: r.ownerPrivyId,
    owner_wallet: r.ownerWallet,
    name: r.name,
    network: r.network,
    model: r.model,
    system_prompt: r.systemPrompt,
    capabilities: r.capabilities,
    budget: {
      per_action: r.budget.perAction,
      per_task: r.budget.perTask,
      per_day: r.budget.perDay,
    },
    treasury: r.treasury,
    service_key_id: r.serviceKeyId,
    llm_provider: r.llmProvider,
    status: r.status,
    created_at: r.createdAt,
  };
}

function getEncryptionKey(): string {
  const k = process.env.ENCRYPTION_KEY?.trim();
  if (!k || k.length !== 64) {
    throw invalidRequest(
      'server is missing ENCRYPTION_KEY (32-byte hex). agent creation is disabled.',
    );
  }
  return k;
}

export function buildPlatformAgentRoutes(deps: PlatformAgentDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  app.use('/v1/platform/*', adminAuth(deps.config.adminSecret));

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/platform/agents',
      tags: ['platform'],
      summary: 'Record a new agent (after browser-side mint) and issue its service key',
      security: [{ AdminSecret: [] }],
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: CreatePlatformAgentBody } },
        },
      },
      responses: {
        200: {
          description: 'Agent recorded, service key issued.',
          content: {
            'application/json': {
              schema: z.object({
                agent: PlatformAgentSchema,
                service_key_plaintext: z.string().openapi({
                  description: 'Service key for the agent-runtime worker. Returned ONCE.',
                }),
              }),
            },
          },
        },
        401: { description: 'auth', content: { 'application/json': { schema: ApiErrorSchema } } },
        422: {
          description: 'invalid',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const encKey = getEncryptionKey();
      const sealed = encryptSecret(body.llm_api_key, encKey);
      const service = await createApiKey(deps.db, {
        label: `agent:${body.mint.slice(0, 8)}`,
        network: body.network,
        ownerWallet: body.owner_wallet,
        scopes: ['agents'],
      });
      const capabilities: Capability[] = body.capabilities.map((cap) => ({
        slug: cap.slug,
        endpoint: cap.endpoint,
        tools: cap.tools,
        ...(cap.paid !== undefined ? { paid: cap.paid } : {}),
      }));
      const created = await createPlatformAgent(deps.db, {
        mint: body.mint,
        ownerPrivyId: body.owner_privy_id,
        ownerWallet: body.owner_wallet,
        name: body.name,
        network: body.network,
        model: body.model,
        systemPrompt: body.system_prompt,
        capabilities,
        budget: {
          perAction: body.budget.per_action,
          perTask: body.budget.per_task,
          perDay: body.budget.per_day,
        },
        treasury: body.treasury,
        serviceKeyId: service.key.id,
        encryptedLlmKey: sealed,
        llmProvider: body.llm_provider,
      });
      return c.json(
        {
          agent: rowToWire(created)!,
          service_key_plaintext: service.plaintext,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/agents/{mint}',
      tags: ['platform'],
      summary: 'Fetch a platform agent by mint',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PlatformAgentSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const row = await getPlatformAgent(deps.db, mint);
      if (!row) throw notFound('agent not found');
      return c.json(rowToWire(row)!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/agents',
      tags: ['platform'],
      summary: 'List platform agents for an owner',
      security: [{ AdminSecret: [] }],
      request: { query: z.object({ owner_privy_id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': { schema: z.object({ items: z.array(PlatformAgentSchema) }) },
          },
        },
      },
    }),
    async (c) => {
      const { owner_privy_id } = c.req.valid('query');
      const rows = await listPlatformAgentsForOwner(deps.db, owner_privy_id);
      return c.json({ items: rows.map((r) => rowToWire(r)!) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/platform/agents/{mint}',
      tags: ['platform'],
      summary: 'Update agent capabilities',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({ capabilities: z.array(CapabilitySchema) }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PlatformAgentSchema } },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const { capabilities } = c.req.valid('json');
      const existing = await getPlatformAgent(deps.db, mint);
      if (!existing) throw notFound('agent not found');
      await updatePlatformAgentCapabilities(
        deps.db,
        mint,
        capabilities.map((cap) => ({
          slug: cap.slug,
          endpoint: cap.endpoint,
          tools: cap.tools,
          ...(cap.paid !== undefined ? { paid: cap.paid } : {}),
        })),
      );
      const after = await getPlatformAgent(deps.db, mint);
      return c.json(rowToWire(after)!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/platform/agents/{mint}',
      tags: ['platform'],
      summary: 'Disable a platform agent and revoke its service key',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const existing = await getPlatformAgent(deps.db, mint);
      if (!existing) throw notFound('agent not found');
      await disablePlatformAgent(deps.db, mint);
      await disableApiKey(deps.db, existing.serviceKeyId);
      await markKeyRevoked(deps.cache, existing.serviceKeyId);
      return c.json({ ok: true as const }, 200);
    },
  );

  return app;
}
