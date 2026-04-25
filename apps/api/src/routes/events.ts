/**
 * Read-side: event status lookup and filterable feed.
 *
 * Network is always taken from the caller's API key — there is no way
 * to query devnet events with a `lsh_live_*` key, by design.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { getEventById, listEvents, type EventKind, type EventRow } from '../storage/events.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { notFound } from '../util/errors.js';

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
  'payment_link.created',
  'payment_link.updated',
  'payment_link.deleted',
  'payment_link.served',
  'payment_link.settled',
  'buyer.payment.prepare',
] as const satisfies readonly EventKind[];

const EventResponseSchema = z.object({
  id: z.string(),
  ts: z.string(),
  kind: z.enum(EVENT_KINDS),
  phase: z.enum(['prepared', 'submitted', 'confirmed', 'failed']),
  network: NetworkSchema,
  client_reference: z.string().nullable(),
  agent_asset: PubkeySchema.nullable(),
  signature: z.string().nullable(),
  mint: PubkeySchema.nullable(),
  amount_atomic: z.string().nullable(),
  metadata: z.record(z.unknown()),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  failed_at: z.string().nullable(),
});

export function buildEventRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/events/{id}',
      tags: ['events'],
      summary: 'Look up a single event by id.',
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          description: 'Event row.',
          content: { 'application/json': { schema: EventResponseSchema } },
        },
        404: {
          description: 'Not found (or wrong network).',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const network = c.var.network;
      const event = await getEventById(deps.db, id);
      if (!event || event.network !== network) {
        throw notFound('event not found on this network');
      }
      return c.json(rowToResponse(event), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/events',
      tags: ['events'],
      summary: "Filterable event feed (network is bound to the caller's key).",
      request: {
        query: z.object({
          kind: z.enum(EVENT_KINDS).optional(),
          agent: PubkeySchema.optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: 'Page of events.',
          content: {
            'application/json': {
              schema: z.object({
                items: z.array(EventResponseSchema),
                next_cursor: z.string().nullable(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const network = c.var.network;
      const items = await listEvents(deps.db, {
        network,
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.agent ? { agent: q.agent } : {}),
        ...(q.cursor ? { cursor: q.cursor } : {}),
        ...(q.limit ? { limit: q.limit } : {}),
      });
      const nextCursor =
        items.length > 0 && items.length === (q.limit ?? 50) ? items[items.length - 1]!.id : null;
      return c.json(
        {
          items: items.map(rowToResponse),
          next_cursor: nextCursor,
        },
        200,
      );
    },
  );

  return app;
}

function rowToResponse(row: EventRow): z.infer<typeof EventResponseSchema> {
  return {
    id: row.id,
    ts: row.ts,
    kind: row.kind,
    phase: row.phase,
    network: row.network,
    client_reference: row.clientReference,
    agent_asset: row.agentAsset,
    signature: row.signature,
    mint: row.mint,
    amount_atomic: row.amountAtomic,
    metadata: row.metadata,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    confirmed_at: row.confirmedAt,
    failed_at: row.failedAt,
  };
}
