/**
 * Agent-keyed webhook subscription endpoints.
 *
 * Auth model
 * ----------
 * These endpoints authenticate via the on-chain `X-Leash-Sig` header
 * — the executive ed25519 signature over a canonical request envelope
 * — instead of an API key. That lets standalone-MCP / CLI agents
 * subscribe to their own webhooks without ever provisioning a Leash
 * platform key. The `agent_mint` path param is verified against the
 * `X-Leash-Agent` header inside the middleware so callers can't
 * subscribe a different agent than the one they signed for.
 *
 * Endpoints
 * ---------
 *   POST   /v1/agents/{mint}/webhooks         — create or upsert
 *   GET    /v1/agents/{mint}/webhooks         — list (no secrets)
 *   DELETE /v1/agents/{mint}/webhooks/{id}    — delete + purge deliveries
 *
 * Note: the dispatcher in `enqueueDeliveriesForEvent` is already
 * `agent_asset`-aware, so once a row is in the table no further
 * wiring is needed.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { onChainAuth, type OnChainAuthVariables, type OnChainAuthDeps } from '../auth/onchain.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { getPlatformAgent } from '../storage/platform-agents.js';
import {
  createAgentWebhook,
  deleteWebhook,
  getWebhookById,
  listAgentWebhooks,
} from '../storage/webhooks.js';
import { invalidRequest, notFound, unauthorized } from '../util/errors.js';

const EVENT_KINDS = [
  'agent.create',
  'agent.identity.register',
  'agent.executive.register',
  'agent.executive.delegate',
  'agent.delegation.set',
  'agent.delegation.revoke',
  'agent.treasury.provision',
  'agent.treasury.withdraw',
  'agent.treasury.withdraw_sol',
  'agent.treasury.fund',
  'agent.treasury.fund_sol',
  'agent.token.set',
  'submit.raw',
  'receipt.published',
  'receipt.pulled',
  'payment_link.created',
  'payment_link.updated',
  'payment_link.deleted',
  'payment_link.served',
  'payment_link.settled',
  'buyer.payment.prepare',
  'protocol.fee.collected',
] as const;

const WebhookSchema = z
  .object({
    id: z.string(),
    agent_mint: PubkeySchema,
    network: NetworkSchema,
    url: z.string().url(),
    events: z.array(z.enum(EVENT_KINDS)),
    disabled_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('AgentWebhook');

const WebhookWithSecretSchema = WebhookSchema.extend({
  secret: z.string().openapi({
    description: 'HMAC-SHA256 signing secret. Returned ONCE on create — store it now.',
  }),
});

export type AgentWebhookDeps = OnChainAuthDeps;

export function buildAgentWebhookRoutes(deps: AgentWebhookDeps): OpenAPIHono<{
  Variables: OnChainAuthVariables;
}> {
  const app = new OpenAPIHono<{ Variables: OnChainAuthVariables }>();

  // All routes here are gated by the on-chain auth middleware. The
  // `agent_mint` param is reconciled against `X-Leash-Agent` in the
  // route bodies so a caller can't subscribe-on-behalf-of-someone-else.
  app.use('/v1/agents/:mint/webhooks', onChainAuth(deps));
  app.use('/v1/agents/:mint/webhooks/:id', onChainAuth(deps));

  // POST /v1/agents/{mint}/webhooks
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/webhooks',
      tags: ['webhooks'],
      summary: 'Subscribe to events for an agent (X-Leash-Sig auth).',
      description:
        "Caller signs the request with the agent's executive keypair. The dispatcher fans out only events whose `agent_asset` matches `mint` — agents see their own activity, not the whole network. Returns the signing secret ONCE.",
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                url: z.string().url(),
                events: z.array(z.enum(EVENT_KINDS)).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Subscription created (or upserted).',
          content: { 'application/json': { schema: WebhookWithSecretSchema } },
        },
        401: {
          description: 'On-chain auth failed.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      if (mint !== c.var.agent_mint) {
        throw unauthorized('X-Leash-Agent must equal :mint path param');
      }
      const body = c.req.valid('json');
      if (!/^https?:\/\//i.test(body.url)) {
        throw invalidRequest('webhook url must start with http(s)://');
      }

      // The on-chain auth middleware already resolved the agent
      // against the platform_agents table; we re-read it here purely
      // to get the network. Cheap (single PK lookup) and keeps the
      // middleware's contract small (it only owns auth, not metadata).
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      const network = agent.network;

      const sub = await createAgentWebhook(deps.db, {
        agentMint: mint,
        network,
        url: body.url,
        ...(body.events ? { events: body.events } : {}),
      });

      return c.json(
        {
          id: sub.id,
          agent_mint: mint,
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

  // GET /v1/agents/{mint}/webhooks
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agents/{mint}/webhooks',
      tags: ['webhooks'],
      summary: 'List subscriptions for an agent.',
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'Subscriptions (secret omitted).',
          content: {
            'application/json': {
              schema: z.object({ items: z.array(WebhookSchema) }),
            },
          },
        },
        401: {
          description: 'On-chain auth failed.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      if (mint !== c.var.agent_mint) {
        throw unauthorized('X-Leash-Agent must equal :mint path param');
      }
      const rows = await listAgentWebhooks(deps.db, mint);
      return c.json(
        {
          items: rows.map((r) => ({
            id: r.id,
            agent_mint: r.agentMint ?? mint,
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

  // DELETE /v1/agents/{mint}/webhooks/{id}
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/agents/{mint}/webhooks/{id}',
      tags: ['webhooks'],
      summary: 'Delete a subscription and purge its delivery history.',
      request: {
        params: z.object({ mint: PubkeySchema, id: z.string() }),
      },
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
      const { mint, id } = c.req.valid('param');
      if (mint !== c.var.agent_mint) {
        throw unauthorized('X-Leash-Agent must equal :mint path param');
      }
      const sub = await getWebhookById(deps.db, id);
      if (!sub || sub.agentMint !== mint) throw notFound('webhook not found');
      await deleteWebhook(deps.db, id);
      return c.json({ ok: true as const }, 200);
    },
  );

  return app;
}
