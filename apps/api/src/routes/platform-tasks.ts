/**
 * `/v1/platform/tasks` — admin-gated task queue endpoints used by the
 * `agent.leash.market` BFF and `apps/agent-runtime` worker.
 *
 * Endpoints:
 *   POST /v1/platform/tasks            — enqueue a task for an agent
 *   GET  /v1/platform/tasks/:id        — fetch a single task
 *   GET  /v1/platform/tasks            — list tasks for an agent
 *   GET  /v1/platform/tasks/:id/activities — list persisted activity rows
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { adminAuth } from '../auth/admin.js';
import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, PubkeySchema } from '../openapi/common.js';
import {
  createTask,
  getTask,
  listTaskActivities,
  listTasksForAgent,
} from '../storage/platform-tasks.js';
import { getPlatformAgent } from '../storage/platform-agents.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import { invalidRequest, notFound } from '../util/errors.js';

export type PlatformTaskDeps = { config: LeashApiConfig; db: DbClient; cache: CacheClient };

const TaskStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'out_of_budget']);

const TaskSchema = z
  .object({
    id: z.string(),
    agent_mint: PubkeySchema,
    prompt: z.string(),
    budget_cap: z.string(),
    status: TaskStatusSchema,
    spent: z.string(),
    final_output: z.string().nullable(),
    error: z.string().nullable(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('PlatformTask');

const ActivitySchema = z
  .object({
    id: z.string(),
    task_id: z.string(),
    type: z.enum(['think', 'tool_call', 'payment', 'tool_result', 'done', 'error']),
    payload: z.record(z.unknown()),
    cost_usdc: z.string().nullable(),
    receipt_id: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('TaskActivity');

function taskToWire(t: NonNullable<Awaited<ReturnType<typeof getTask>>>) {
  return {
    id: t.id,
    agent_mint: t.agentMint,
    prompt: t.prompt,
    budget_cap: t.budgetCap,
    status: t.status,
    spent: t.spent,
    final_output: t.finalOutput,
    error: t.error,
    started_at: t.startedAt,
    finished_at: t.finishedAt,
    created_at: t.createdAt,
  };
}

function activityToWire(a: Awaited<ReturnType<typeof listTaskActivities>>[number]) {
  return {
    id: a.id,
    task_id: a.taskId,
    type: a.type,
    payload: a.payload,
    cost_usdc: a.costUsdc,
    receipt_id: a.receiptId,
    created_at: a.createdAt,
  };
}

export function buildPlatformTaskRoutes(deps: PlatformTaskDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  app.use('/v1/platform/*', adminAuth(deps.config.adminSecret));

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/platform/tasks',
      tags: ['platform'],
      summary: 'Enqueue a task for an agent',
      security: [{ AdminSecret: [] }],
      request: {
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                agent_mint: PubkeySchema,
                prompt: z.string().min(1).max(4000),
                budget_cap: z.string().min(1),
              }),
            },
          },
        },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: TaskSchema } } },
        404: {
          description: 'agent not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const agent = await getPlatformAgent(deps.db, body.agent_mint);
      if (!agent || agent.status !== 'active') {
        throw notFound('agent not found');
      }
      const cap = Number.parseFloat(body.budget_cap);
      if (!Number.isFinite(cap) || cap <= 0) {
        throw invalidRequest('budget_cap must be a positive number');
      }
      const task = await createTask(deps.db, {
        agentMint: body.agent_mint,
        prompt: body.prompt,
        budgetCap: body.budget_cap,
      });
      return c.json(taskToWire(task), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/tasks/{id}',
      tags: ['platform'],
      summary: 'Fetch a task',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: TaskSchema } } },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const t = await getTask(deps.db, id);
      if (!t) throw notFound('task not found');
      return c.json(taskToWire(t), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/tasks',
      tags: ['platform'],
      summary: 'List tasks for an agent (most recent first)',
      security: [{ AdminSecret: [] }],
      request: {
        query: z.object({
          agent_mint: PubkeySchema,
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': { schema: z.object({ items: z.array(TaskSchema) }) },
          },
        },
      },
    }),
    async (c) => {
      const { agent_mint, limit } = c.req.valid('query');
      const items = await listTasksForAgent(deps.db, agent_mint, limit ?? 50);
      return c.json({ items: items.map(taskToWire) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/tasks/{id}/activities',
      tags: ['platform'],
      summary: 'List activity rows for a task',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': { schema: z.object({ items: z.array(ActivitySchema) }) },
          },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const t = await getTask(deps.db, id);
      if (!t) throw notFound('task not found');
      const acts = await listTaskActivities(deps.db, id);
      return c.json({ items: acts.map(activityToWire) }, 200);
    },
  );

  return app;
}
