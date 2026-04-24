/**
 * Webhook subscription management.
 *
 * Endpoints (network-scoped via the API key):
 *   - POST   /v1/webhooks                — create or upsert a subscription
 *   - GET    /v1/webhooks                — list active subscriptions
 *   - GET    /v1/webhooks/{id}           — fetch one subscription
 *   - DELETE /v1/webhooks/{id}           — disable + purge deliveries
 *   - GET    /v1/webhooks/{id}/deliveries — recent attempts (status/errors)
 *
 * The first response after creating a subscription is the *only* time
 * the secret is returned in plaintext (mirroring API key creation).
 * Receivers must persist it and use it to verify the
 * `X-Leash-Signature` header on every delivery — see `webhooks/sign.ts`.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import {
  createWebhook,
  deleteWebhook,
  getWebhookById,
  listRecentDeliveries,
  listWebhooks,
} from '../storage/webhooks.js';
import { ApiErrorSchema, NetworkSchema } from '../openapi/common.js';
import { invalidRequest, notFound } from '../util/errors.js';

const EVENT_KINDS = [
  'agent.identity.register',
  'agent.executive.register',
  'agent.executive.delegate',
  'agent.delegation.set',
  'agent.delegation.revoke',
  'agent.treasury.provision',
  'agent.treasury.withdraw',
  'agent.treasury.withdraw_sol',
  'agent.token.set',
  'submit.raw',
  'receipt.published',
  'receipt.pulled',
] as const;

const WebhookSchema = z
  .object({
    id: z.string(),
    network: NetworkSchema,
    url: z.string().url(),
    events: z.array(z.enum(EVENT_KINDS)),
    disabled_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('Webhook');

const WebhookWithSecretSchema = WebhookSchema.extend({
  secret: z.string().openapi({
    description: 'HMAC-SHA256 signing secret. Returned ONCE on create — store it now.',
  }),
});

const DeliverySchema = z
  .object({
    id: z.string(),
    webhook_id: z.string(),
    event_id: z.string(),
    attempts: z.number().int().nonnegative(),
    delivered: z.boolean(),
    next_attempt_at: z.string(),
    last_status: z.number().int().nullable(),
    last_error: z.string().nullable(),
    last_attempt_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('WebhookDelivery');

export function buildWebhookRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  // POST /v1/webhooks
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/webhooks',
      tags: ['webhooks'],
      summary: 'Create or upsert an outbound webhook subscription.',
      request: {
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                url: z.string().url().openapi({
                  description: 'Receiver URL. Must be HTTPS in production.',
                }),
                events: z.array(z.enum(EVENT_KINDS)).optional().openapi({
                  description: 'Subscribe to specific event kinds. Empty/omitted = all kinds.',
                }),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Subscription created (or updated, same id + secret).',
          content: { 'application/json': { schema: WebhookWithSecretSchema } },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      if (!/^https?:\/\//i.test(body.url)) {
        throw invalidRequest('webhook url must start with http(s)://');
      }
      const sub = await createWebhook(deps.db, {
        apiKeyId: c.var.apiKey.id,
        network: c.var.network,
        url: body.url,
        ...(body.events ? { events: body.events } : {}),
      });
      return c.json(
        {
          id: sub.id,
          network: sub.network,
          url: sub.url,
          events: sub.events,
          disabled_at: sub.disabledAt,
          created_at: sub.createdAt,
          secret: sub.secret,
        },
        200,
      );
    },
  );

  // GET /v1/webhooks
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/webhooks',
      tags: ['webhooks'],
      summary: 'List subscriptions on the caller key.',
      responses: {
        200: {
          description: 'Subscriptions (secret omitted).',
          content: {
            'application/json': {
              schema: z.object({ items: z.array(WebhookSchema) }),
            },
          },
        },
      },
    }),
    async (c) => {
      const rows = await listWebhooks(deps.db, c.var.apiKey.id);
      return c.json(
        {
          items: rows.map((r) => ({
            id: r.id,
            network: r.network,
            url: r.url,
            events: r.events,
            disabled_at: r.disabledAt,
            created_at: r.createdAt,
          })),
        },
        200,
      );
    },
  );

  // GET /v1/webhooks/{id}
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/webhooks/{id}',
      tags: ['webhooks'],
      summary: 'Fetch a subscription by id (must belong to caller key).',
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          description: 'Subscription.',
          content: { 'application/json': { schema: WebhookSchema } },
        },
        404: {
          description: 'Not found.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const sub = await getWebhookById(deps.db, id);
      if (!sub || sub.apiKeyId !== c.var.apiKey.id) {
        throw notFound('webhook not found');
      }
      return c.json(
        {
          id: sub.id,
          network: sub.network,
          url: sub.url,
          events: sub.events,
          disabled_at: sub.disabledAt,
          created_at: sub.createdAt,
        },
        200,
      );
    },
  );

  // DELETE /v1/webhooks/{id}
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/webhooks/{id}',
      tags: ['webhooks'],
      summary: 'Delete a subscription and purge its delivery history.',
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          description: 'Deleted.',
          content: {
            'application/json': {
              schema: z.object({ ok: z.literal(true) }),
            },
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
      const sub = await getWebhookById(deps.db, id);
      if (!sub || sub.apiKeyId !== c.var.apiKey.id) {
        throw notFound('webhook not found');
      }
      await deleteWebhook(deps.db, id);
      return c.json({ ok: true as const }, 200);
    },
  );

  // GET /v1/webhooks/{id}/deliveries
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/webhooks/{id}/deliveries',
      tags: ['webhooks'],
      summary: 'Recent delivery attempts for a subscription.',
      request: {
        params: z.object({ id: z.string() }),
        query: z.object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: {
        200: {
          description: 'Recent attempts (newest first).',
          content: {
            'application/json': {
              schema: z.object({ items: z.array(DeliverySchema) }),
            },
          },
        },
        404: {
          description: 'Subscription not found.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { limit } = c.req.valid('query');
      const sub = await getWebhookById(deps.db, id);
      if (!sub || sub.apiKeyId !== c.var.apiKey.id) {
        throw notFound('webhook not found');
      }
      const rows = await listRecentDeliveries(deps.db, id, limit ?? 50);
      return c.json(
        {
          items: rows.map((r) => ({
            id: r.id,
            webhook_id: r.webhookId,
            event_id: r.eventId,
            attempts: r.attempts,
            delivered: r.delivered,
            next_attempt_at: r.nextAttemptAt,
            last_status: r.lastStatus,
            last_error: r.lastError,
            last_attempt_at: r.lastAttemptAt,
            created_at: r.createdAt,
          })),
        },
        200,
      );
    },
  );

  return app;
}
