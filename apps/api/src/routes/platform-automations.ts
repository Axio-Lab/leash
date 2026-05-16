/**
 * `/v1/platform/automations` — admin-gated CRUD for user-owned agent
 * automations. Browser sessions are authenticated in apps/agents; this
 * route receives the resolved `owner_privy_id` and enforces that every
 * read/write stays scoped to that owner.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { adminAuth } from '../auth/admin.js';
import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, PubkeySchema } from '../openapi/common.js';
import {
  createAutomation,
  deleteAutomationForOwner,
  getAutomationForOwner,
  listAutomationRunsForOwner,
  listAutomationsForOwner,
  updateAutomationForOwner,
  type AutomationRow,
  type AutomationRunRow,
} from '../storage/automations.js';
import { getPlatformAgent } from '../storage/platform-agents.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import { invalidRequest, notFound } from '../util/errors.js';

export type PlatformAutomationDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
};

const TriggerTypeSchema = z.enum(['schedule', 'webhook', 'event']);
const StatusSchema = z.enum(['enabled', 'paused']);
const DeliveryPolicySchema = z.enum([
  'history_only',
  'every_run',
  'on_failure',
  'on_condition',
  'silent',
]);
const JsonObjectSchema = z.record(z.unknown());

const AutomationSchema = z
  .object({
    id: z.string(),
    owner_privy_id: z.string(),
    agent_mint: PubkeySchema,
    name: z.string(),
    description: z.string().nullable(),
    status: StatusSchema,
    trigger_type: TriggerTypeSchema,
    trigger_config: JsonObjectSchema,
    source_config: JsonObjectSchema,
    delivery_policy: DeliveryPolicySchema,
    delivery_config: JsonObjectSchema,
    budget_per_run: z.string(),
    budget_per_day: z.string(),
    timezone: z.string(),
    next_run_at: z.string().nullable(),
    last_run_at: z.string().nullable(),
    last_status: z.string().nullable(),
    failure_count: z.number().int(),
    retention_days: z.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Automation');

const AutomationRunSchema = z
  .object({
    id: z.string(),
    automation_id: z.string(),
    owner_privy_id: z.string(),
    agent_mint: PubkeySchema,
    trigger_type: TriggerTypeSchema,
    trigger_payload: JsonObjectSchema,
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled']),
    output_text: z.string().nullable(),
    error: z.string().nullable(),
    source_summary: JsonObjectSchema,
    delivery_status: z.string().nullable(),
    delivery_result: JsonObjectSchema,
    spend_usd: z.string(),
    receipts: z.array(z.unknown()),
    idempotency_key: z.string().nullable(),
    claimed_by: z.string().nullable(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('AutomationRun');

const CreateAutomationBody = z.object({
  owner_privy_id: z.string().min(1),
  agent_mint: PubkeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  status: StatusSchema.default('paused'),
  trigger_type: TriggerTypeSchema,
  trigger_config: JsonObjectSchema.default({}),
  source_config: JsonObjectSchema.default({}),
  delivery_policy: DeliveryPolicySchema.default('history_only'),
  delivery_config: JsonObjectSchema.default({}),
  budget_per_run: z.string().default('0'),
  budget_per_day: z.string().default('0'),
  timezone: z.string().min(1).max(80).default('UTC'),
  next_run_at: z.string().optional().nullable(),
  retention_days: z.coerce.number().int().min(1).max(365).default(30),
});

const PatchAutomationBody = CreateAutomationBody.omit({ owner_privy_id: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });

function automationToWire(row: AutomationRow) {
  return {
    id: row.id,
    owner_privy_id: row.ownerPrivyId,
    agent_mint: row.agentMint,
    name: row.name,
    description: row.description,
    status: row.status,
    trigger_type: row.triggerType,
    trigger_config: row.triggerConfig,
    source_config: row.sourceConfig,
    delivery_policy: row.deliveryPolicy,
    delivery_config: row.deliveryConfig,
    budget_per_run: row.budgetPerRun,
    budget_per_day: row.budgetPerDay,
    timezone: row.timezone,
    next_run_at: row.nextRunAt,
    last_run_at: row.lastRunAt,
    last_status: row.lastStatus,
    failure_count: row.failureCount,
    retention_days: row.retentionDays,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function runToWire(row: AutomationRunRow) {
  return {
    id: row.id,
    automation_id: row.automationId,
    owner_privy_id: row.ownerPrivyId,
    agent_mint: row.agentMint,
    trigger_type: row.triggerType,
    trigger_payload: row.triggerPayload,
    status: row.status,
    output_text: row.outputText,
    error: row.error,
    source_summary: row.sourceSummary,
    delivery_status: row.deliveryStatus,
    delivery_result: row.deliveryResult,
    spend_usd: row.spendUsd,
    receipts: row.receipts,
    idempotency_key: row.idempotencyKey,
    claimed_by: row.claimedBy,
    started_at: row.startedAt,
    finished_at: row.finishedAt,
    created_at: row.createdAt,
  };
}

function assertBudget(value: string, field: string): void {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) {
    throw invalidRequest(`${field} must be a non-negative number`);
  }
}

async function assertAgentOwned(deps: PlatformAutomationDeps, ownerPrivyId: string, mint: string) {
  const agent = await getPlatformAgent(deps.db, mint);
  if (!agent || agent.status !== 'active') throw notFound('agent not found');
  if (agent.ownerPrivyId !== ownerPrivyId) throw notFound('agent not found');
}

function ownerFromQuery(owner: string | undefined): string {
  if (!owner) throw invalidRequest('owner_privy_id is required');
  return owner;
}

export function buildPlatformAutomationRoutes(deps: PlatformAutomationDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  app.use('/v1/platform/*', adminAuth(deps.config.adminSecret));

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/automations',
      tags: ['platform'],
      summary: 'List automations for a Privy owner',
      security: [{ AdminSecret: [] }],
      request: {
        query: z.object({
          owner_privy_id: z.string().min(1),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': { schema: z.object({ items: z.array(AutomationSchema) }) },
          },
        },
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const items = await listAutomationsForOwner(deps.db, q.owner_privy_id, q.limit ?? 100);
      return c.json({ items: items.map(automationToWire) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/platform/automations',
      tags: ['platform'],
      summary: 'Create an automation',
      security: [{ AdminSecret: [] }],
      request: {
        body: { required: true, content: { 'application/json': { schema: CreateAutomationBody } } },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: AutomationSchema } },
        },
        404: {
          description: 'agent not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        422: {
          description: 'invalid',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      assertBudget(body.budget_per_run, 'budget_per_run');
      assertBudget(body.budget_per_day, 'budget_per_day');
      await assertAgentOwned(deps, body.owner_privy_id, body.agent_mint);
      const row = await createAutomation(deps.db, {
        ownerPrivyId: body.owner_privy_id,
        agentMint: body.agent_mint,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        status: body.status,
        triggerType: body.trigger_type,
        triggerConfig: body.trigger_config,
        sourceConfig: body.source_config,
        deliveryPolicy: body.delivery_policy,
        deliveryConfig: body.delivery_config,
        budgetPerRun: body.budget_per_run,
        budgetPerDay: body.budget_per_day,
        timezone: body.timezone,
        nextRunAt: body.next_run_at ?? null,
        retentionDays: body.retention_days,
      });
      return c.json(automationToWire(row), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/automations/{id}',
      tags: ['platform'],
      summary: 'Fetch an automation',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
        query: z.object({ owner_privy_id: z.string().min(1) }),
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: AutomationSchema } } },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const owner = ownerFromQuery(c.req.valid('query').owner_privy_id);
      const row = await getAutomationForOwner(deps.db, owner, id);
      if (!row) throw notFound('automation not found');
      return c.json(automationToWire(row), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/platform/automations/{id}',
      tags: ['platform'],
      summary: 'Patch an automation',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
        query: z.object({ owner_privy_id: z.string().min(1) }),
        body: { required: true, content: { 'application/json': { schema: PatchAutomationBody } } },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: AutomationSchema } } },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        422: {
          description: 'invalid',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const owner = ownerFromQuery(c.req.valid('query').owner_privy_id);
      const body = c.req.valid('json');
      if (body.budget_per_run !== undefined) assertBudget(body.budget_per_run, 'budget_per_run');
      if (body.budget_per_day !== undefined) assertBudget(body.budget_per_day, 'budget_per_day');
      if (body.agent_mint) await assertAgentOwned(deps, owner, body.agent_mint);
      const row = await updateAutomationForOwner(deps.db, owner, id, {
        ...(body.agent_mint !== undefined ? { agentMint: body.agent_mint } : {}),
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined
          ? { description: body.description?.trim() || null }
          : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.trigger_type !== undefined ? { triggerType: body.trigger_type } : {}),
        ...(body.trigger_config !== undefined ? { triggerConfig: body.trigger_config } : {}),
        ...(body.source_config !== undefined ? { sourceConfig: body.source_config } : {}),
        ...(body.delivery_policy !== undefined ? { deliveryPolicy: body.delivery_policy } : {}),
        ...(body.delivery_config !== undefined ? { deliveryConfig: body.delivery_config } : {}),
        ...(body.budget_per_run !== undefined ? { budgetPerRun: body.budget_per_run } : {}),
        ...(body.budget_per_day !== undefined ? { budgetPerDay: body.budget_per_day } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.next_run_at !== undefined ? { nextRunAt: body.next_run_at ?? null } : {}),
        ...(body.retention_days !== undefined ? { retentionDays: body.retention_days } : {}),
      });
      if (!row) throw notFound('automation not found');
      return c.json(automationToWire(row), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/platform/automations/{id}',
      tags: ['platform'],
      summary: 'Delete an automation',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
        query: z.object({ owner_privy_id: z.string().min(1) }),
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const owner = ownerFromQuery(c.req.valid('query').owner_privy_id);
      const ok = await deleteAutomationForOwner(deps.db, owner, id);
      if (!ok) throw notFound('automation not found');
      return c.json({ ok: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/automations/{id}/runs',
      tags: ['platform'],
      summary: 'List automation runs',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
        query: z.object({
          owner_privy_id: z.string().min(1),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': { schema: z.object({ items: z.array(AutomationRunSchema) }) },
          },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const q = c.req.valid('query');
      const items = await listAutomationRunsForOwner(deps.db, q.owner_privy_id, id, q.limit ?? 50);
      return c.json({ items: items.map(runToWire) }, 200);
    },
  );

  return app;
}
