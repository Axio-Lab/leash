/**
 * Signed-transaction broadcast.
 *
 * The caller submits a base64-encoded signed transaction and (optionally)
 * the `event_id` returned by the matching `prepare*` call. The server
 * deserialises, broadcasts via the network's RPC, and:
 *
 *   - if `event_id` is provided, links the submission to the existing
 *     event row and transitions phase: `prepared -> submitted`;
 *   - otherwise creates a new `submit.raw` event row.
 *
 * A best-effort background poller flips the row to `confirmed` or
 * `failed` once the chain has an answer. The poller is intentionally
 * simple — Phase 6 will harden it with proper retries and metrics.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { base58 } from '@metaplex-foundation/umi/serializers';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import {
  createPreparedEvent,
  getEventById,
  markConfirmed,
  markFailed,
  markSubmitted,
} from '../storage/events.js';
import type { DbClient } from '../storage/turso.js';
import { ApiErrorSchema, NetworkSchema } from '../openapi/common.js';
import { invalidRequest, networkMismatch, rpcError } from '../util/errors.js';
import { base64ToBytes } from '../util/serialize.js';
import { umiReadOnly } from '../util/umi.js';

const SubmitBody = z.object({
  transaction_base64: z.string().min(1),
  event_id: z.string().optional(),
  client_reference: z.string().max(256).optional(),
});

const SubmitResponse = z.object({
  event_id: z.string(),
  signature: z.string(),
  phase: z.enum(['submitted']),
  network: NetworkSchema,
});

export function buildSubmitRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/submit',
      tags: ['submit'],
      summary: 'Broadcast a signed transaction and track its lifecycle.',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: SubmitBody } },
        },
      },
      responses: {
        200: {
          description: 'Transaction broadcast.',
          content: { 'application/json': { schema: SubmitResponse } },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        502: {
          description: 'RPC error.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network = c.var.network;
      const apiKey = c.var.apiKey;

      let txBytes: Uint8Array;
      try {
        txBytes = base64ToBytes(body.transaction_base64);
      } catch (err) {
        throw invalidRequest('transaction_base64 is not valid base64', String(err));
      }

      let eventId = body.event_id ?? null;
      if (eventId) {
        const existing = await getEventById(deps.db, eventId);
        if (!existing) {
          throw invalidRequest('event_id not found');
        }
        if (existing.network !== network) {
          throw networkMismatch(
            `event_id was prepared on ${existing.network} but key is bound to ${network}`,
          );
        }
      }

      const umi = umiReadOnly(deps.config, network);
      let signature: string;
      try {
        const tx = umi.transactions.deserialize(txBytes);
        const sigBytes = await umi.rpc.sendTransaction(tx, {
          skipPreflight: false,
        });
        signature = base58.deserialize(sigBytes)[0];
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // If we have an event id, mark it failed so callers can poll
        // /v1/events/{id} and see the failure reason.
        if (eventId) {
          await markFailed(deps.db, eventId, 'rpc_error', message);
        }
        throw rpcError('rpc rejected the transaction', message);
      }

      if (!eventId) {
        eventId = await createPreparedEvent(deps.db, {
          kind: 'submit.raw',
          network,
          apiKeyId: apiKey.id,
          clientReference: body.client_reference ?? c.var.clientReference ?? null,
          metadata: { source: 'submit.raw' },
        });
      }
      await markSubmitted(deps.db, eventId, signature);

      // Best-effort confirmation poller. Resolves the lifecycle in the
      // background; callers can poll `/v1/events/{id}` for the latest
      // phase. Errors are swallowed (the event row records them).
      void confirmInBackground(deps, network, eventId, signature);

      return c.json(
        {
          event_id: eventId,
          signature,
          phase: 'submitted' as const,
          network,
        },
        200,
      );
    },
  );

  return app;
}

const CONFIRMATION_TIMEOUT_MS = 60_000;
const CONFIRMATION_INTERVAL_MS = 2_500;

async function confirmInBackground(
  deps: { config: LeashApiConfig; db: DbClient },
  network: 'solana-devnet' | 'solana-mainnet',
  eventId: string,
  signature: string,
): Promise<void> {
  const umi = umiReadOnly(deps.config, network);
  const start = Date.now();
  while (Date.now() - start < CONFIRMATION_TIMEOUT_MS) {
    try {
      const sig58 = base58.serialize(signature) as Uint8Array;
      const statuses = await umi.rpc.getSignatureStatuses([sig58], {
        searchTransactionHistory: true,
      });
      const status = statuses[0];
      if (status != null) {
        if (status.error != null) {
          await markFailed(deps.db, eventId, 'transaction_failed', JSON.stringify(status.error));
          return;
        }
        if (status.commitment === 'confirmed' || status.commitment === 'finalized') {
          await markConfirmed(deps.db, eventId);
          return;
        }
      }
    } catch {
      // keep polling — a transient RPC blip shouldn't kill the watcher
    }
    await new Promise((r) => setTimeout(r, CONFIRMATION_INTERVAL_MS));
  }
  // We never got a definitive answer in the window — leave the row in
  // `submitted` so the indexer/explorer can pick it up later.
}
