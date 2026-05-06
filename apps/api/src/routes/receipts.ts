/**
 * Receipts ingestion + read routes.
 *
 * Buyer/seller kits POST receipt blobs here (`ReceiptV1` or `v: "0.2"` MPP/x402);
 * UIs read them back. Every endpoint is network-scoped through the API
 * key so a devnet key cannot read a mainnet receipt and vice versa.
 *
 * Endpoints:
 *   - `POST /v1/receipts/{agent}`         — push ingest, idempotent on receipt_hash
 *   - `GET  /v1/receipts/{agent}`         — paged feed for a single agent
 *   - `GET  /v1/receipts/by-hash/{hash}`  — direct lookup (network from key)
 *   - `POST /v1/agents/{mint}/pull-target` — register a `services.receipts`
 *                                            URL the API will poll on a cadence
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  ReceiptV1Schema,
  ReceiptV02Schema,
  settlementTxSig,
  type ReceiptAny,
} from '@leashmarket/schemas';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import {
  ingestReceipt,
  listReceipts,
  getReceiptByHash,
  upsertPullTarget,
  listPullTargets,
} from '../storage/receipts.js';
import { createPreparedEvent, markConfirmed, markSubmitted } from '../storage/events.js';
import { emitProtocolFeeEvent } from '../storage/fee-events.js';
import { ensureWatched } from '../indexer/watchlist.js';
import { umiReadOnly } from '../util/umi.js';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { invalidRequest, notFound } from '../util/errors.js';

// `ReceiptV1Schema` is a Zod schema, but `@hono/zod-openapi` re-exports
// its own `z` and the constructed `ReceiptV1Schema` instance is fully
// compatible — it's just a `z.object`. We re-cast to the local `z` type
// so OpenAPI registration keeps the structural definition.
const ReceiptBodySchema: z.ZodType<ReceiptAny> = z.union([
  ReceiptV1Schema,
  ReceiptV02Schema,
]) as unknown as z.ZodType<ReceiptAny>;

const ReceiptListItemSchema = z
  .object({
    receipt_hash: z.string(),
    network: NetworkSchema,
    agent: PubkeySchema,
    nonce: z.number().int().nonnegative(),
    decision: z.string(),
    kind: z.string(),
    tx_sig: z.string().nullable(),
    payment_requirements_hash: z.string().nullable(),
    ingested_at: z.string(),
    raw: z.any().openapi({
      description: 'Canonical receipt JSON (`v: "0.1"` x402 or `v: "0.2"` dual-protocol).',
    }),
  })
  .openapi('Receipt');

const ReceiptIngestResponseSchema = z.object({
  ok: z.literal(true),
  receipt_hash: z.string(),
  duplicate: z.boolean(),
  event_id: z.string().nullable(),
});

const ReceiptListResponseSchema = z.object({
  items: z.array(ReceiptListItemSchema),
  next_cursor: z.string().nullable(),
});

const PullTargetResponseSchema = z.object({
  ok: z.literal(true),
  pull_targets: z.array(
    z.object({
      id: z.number().int(),
      network: NetworkSchema,
      agent: PubkeySchema,
      url: z.string(),
      last_polled_at: z.string().nullable(),
      last_cursor: z.string().nullable(),
    }),
  ),
});

export function buildReceiptRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  // ---------------------------------------------------------------
  // POST /v1/receipts/{agent} — push ingest
  // ---------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receipts/{agent}',
      tags: ['receipts'],
      summary:
        'Ingest a receipt (`v: "0.1"` x402 or `v: "0.2"` MPP/x402). Idempotent on `receipt_hash`.',
      request: {
        params: z.object({ agent: PubkeySchema }),
        body: {
          required: true,
          content: { 'application/json': { schema: ReceiptBodySchema } },
        },
      },
      responses: {
        200: {
          description: 'Receipt accepted (or duplicate).',
          content: { 'application/json': { schema: ReceiptIngestResponseSchema } },
        },
        422: {
          description: 'Receipt failed validation or did not match path agent.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { agent } = c.req.valid('param');
      const receipt = c.req.valid('json');
      if (receipt.agent !== agent) {
        throw invalidRequest(
          'agent mismatch',
          `receipt.agent=${receipt.agent} does not equal path agent=${agent}`,
        );
      }
      const network = c.var.network;
      const apiKey = c.var.apiKey;
      const result = await ingestReceipt(deps.db, { network, receipt });
      // Best-effort enroll the agent in the indexer watchlist so any
      // future on-chain activity (treasury withdraws, identity updates)
      // shows up in the explorer feed for this agent.
      try {
        const umi = umiReadOnly(deps.config, network);
        const [treasury] = findAssetSignerPda(umi, { asset: publicKey(agent) });
        await ensureWatched(deps.db, {
          network,
          agentAsset: agent,
          treasuryAddress: String(treasury),
        });
      } catch {
        // never block receipt ingest on watchlist add
      }
      // Only emit a `receipt.published` event for fresh ingests so the
      // explorer's activity feed isn't flooded by replays from buyer-kit
      // retries. The event row carries enough context that the explorer
      // can deep-link straight to the underlying receipt.
      let eventId: string | null = null;
      if (!result.duplicate) {
        const settledSig = settlementTxSig(receipt);
        eventId = await createPreparedEvent(deps.db, {
          kind: 'receipt.published',
          network,
          apiKeyId: apiKey.id,
          agentAsset: agent,
          metadata: {
            receipt_hash: receipt.receipt_hash,
            ...(settledSig ? { tx_sig: settledSig } : {}),
          },
        });
        // Receipts are terminal — there's no on-chain confirmation to
        // wait for — so flip the row straight to `confirmed` so it
        // shows up in the right bucket on the explorer. We still
        // record the underlying signature on the event row itself so
        // the explorer's tx column isn't blank.
        if (settledSig) await markSubmitted(deps.db, eventId, settledSig);
        await markConfirmed(deps.db, eventId);
        // Best-effort: emit a protocol-fee row when the receipt is a
        // settled earn carrying a `price.fee`. Idempotent on
        // (network, receipt_hash) so retries don't double-count.
        await emitProtocolFeeEvent(deps.db, {
          network,
          receipt,
          apiKeyId: apiKey.id,
        });
      }
      return c.json(
        {
          ok: true as const,
          receipt_hash: result.receiptHash,
          duplicate: result.duplicate,
          event_id: eventId,
        },
        200,
      );
    },
  );

  // ---------------------------------------------------------------
  // GET /v1/receipts/{agent} — paged feed
  // ---------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receipts/{agent}',
      tags: ['receipts'],
      summary: 'List receipts for an agent (newest first), network-scoped.',
      request: {
        params: z.object({ agent: PubkeySchema }),
        query: z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          kind: z.enum(['spend', 'earn']).optional(),
        }),
      },
      responses: {
        200: {
          description: 'Paged receipts feed.',
          content: { 'application/json': { schema: ReceiptListResponseSchema } },
        },
      },
    }),
    async (c) => {
      const { agent } = c.req.valid('param');
      const { cursor, limit, kind } = c.req.valid('query');
      const rows = await listReceipts(deps.db, {
        network: c.var.network,
        agent,
        cursor: cursor ?? null,
        kind: kind ?? null,
        ...(limit ? { limit } : {}),
      });
      const last = rows[rows.length - 1];
      const nextCursor =
        last && rows.length === (limit ?? 50) ? `${last.ingestedAt}|${last.receiptHash}` : null;
      return c.json(
        {
          items: rows.map((r) => ({
            receipt_hash: r.receiptHash,
            network: r.network,
            agent: r.agent,
            nonce: r.nonce,
            decision: r.decision,
            kind: r.kind,
            tx_sig: r.txSig,
            payment_requirements_hash: r.paymentRequirementsHash,
            ingested_at: r.ingestedAt,
            raw: r.raw,
          })),
          next_cursor: nextCursor,
        },
        200,
      );
    },
  );

  // ---------------------------------------------------------------
  // GET /v1/receipts/by-hash/{hash} — direct lookup
  // ---------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receipts/by-hash/{hash}',
      tags: ['receipts'],
      summary: 'Look up a receipt by its `receipt_hash` on the caller network.',
      request: {
        params: z.object({ hash: z.string().min(8).max(128) }),
      },
      responses: {
        200: {
          description: 'Receipt row.',
          content: { 'application/json': { schema: ReceiptListItemSchema } },
        },
        404: {
          description: 'Not found in caller network.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { hash } = c.req.valid('param');
      const row = await getReceiptByHash(deps.db, c.var.network, hash);
      if (!row) {
        throw notFound(
          `receipt ${hash} not found on ${c.var.network} (a hash from the other network is invisible by design)`,
        );
      }
      return c.json(
        {
          receipt_hash: row.receiptHash,
          network: row.network,
          agent: row.agent,
          nonce: row.nonce,
          decision: row.decision,
          kind: row.kind,
          tx_sig: row.txSig,
          payment_requirements_hash: row.paymentRequirementsHash,
          ingested_at: row.ingestedAt,
          raw: row.raw,
        },
        200,
      );
    },
  );

  // ---------------------------------------------------------------
  // POST /v1/agents/{mint}/pull-target — register a feed URL to poll
  // ---------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/pull-target',
      tags: ['receipts'],
      summary:
        'Register a `services.receipts` URL that the API will poll on a cadence to pull receipts for the agent (networks isolated).',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                url: z.string().url().openapi({
                  description:
                    'Either an absolute receipts URL or a `{agent}` template the worker substitutes.',
                }),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description:
            'All registered targets (after upsert) for this agent on the caller network.',
          content: { 'application/json': { schema: PullTargetResponseSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const { url } = c.req.valid('json');
      await upsertPullTarget(deps.db, { network: c.var.network, agent: mint, url });
      const targets = await listPullTargets(deps.db, { network: c.var.network, agent: mint });
      return c.json(
        {
          ok: true as const,
          pull_targets: targets.map((t) => ({
            id: t.id,
            network: t.network,
            agent: t.agent,
            url: t.url,
            last_polled_at: t.lastPolledAt,
            last_cursor: t.lastCursor,
          })),
        },
        200,
      );
    },
  );

  return app;
}
