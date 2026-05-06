/**
 * Read-side endpoints for an agent: identity + treasury balances.
 *
 * Network is bound to the caller's API key, so calling
 * `GET /v1/agents/{mint}` with a `lsh_test_*` key always reads from
 * devnet, even if `mint` exists on mainnet too.
 *
 * The actual RPC reads live in `util/agent-snapshot.ts` so the
 * explorer can re-use them without an HTTP hop.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import { prepareAgentMint } from '@leashmarket/registry-utils';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { umiReadOnly } from '../util/umi.js';
import { getAgentSummary, getAgentTreasuryBalances } from '../util/agent-snapshot.js';
import {
  ApiErrorSchema,
  NetworkSchema,
  PreparedEnvelopeOpenApi,
  PubkeySchema,
} from '../openapi/common.js';
import { ensureWatched, ensureWatchedAta } from '../indexer/watchlist.js';
import { createPreparedEvent } from '../storage/events.js';
import { serializeTransaction } from '../util/serialize.js';
import { internal } from '../util/errors.js';

const AgentSummarySchema = z.object({
  agent_asset: PubkeySchema,
  network: NetworkSchema,
  treasury: PubkeySchema,
  has_identity: z.boolean(),
  identity: z
    .object({
      source: z.enum(['v1', 'v2']),
      asset: PubkeySchema,
    })
    .nullable(),
  token: z.object({
    has_token: z.boolean(),
    mint: PubkeySchema.nullable(),
    source: z.enum(['v1', 'v2', 'none']),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Mint a brand-new agent (POST /v1/agents/prepare).
//
// This is the HTTP twin of `prepareAgentMint` from `@leashmarket/registry-utils`,
// which itself wraps Metaplex's `POST https://api.metaplex.com/v1/agents/mint`.
// We hand back the unsigned transaction the caller signs locally and submits
// via `POST /v1/submit`, exactly like every other prepare endpoint. Because
// the asset address is deterministically derived by Metaplex (and returned in
// the same response), we pre-register the asset + treasury PDA on the
// indexer watchlist so explorer feeds light up the moment the tx lands.
// ─────────────────────────────────────────────────────────────────────────────

const AgentServiceSchema = z
  .object({
    name: z.string().min(1).max(64),
    endpoint: z.string().url(),
  })
  .openapi('AgentService');

const AgentRegistrationSchema = z
  .object({
    agent_id: z.string().min(1),
    agent_registry: z.string().min(1),
  })
  .openapi('AgentRegistration');

const CreateAgentBody = z
  .object({
    wallet: PubkeySchema.openapi({
      description:
        'Owner pubkey. Pays for the mint and is the authority on the resulting Core asset.',
    }),
    name: z.string().min(1).max(64),
    uri: z.string().url().openapi({
      description:
        'NFT-style metadata URI stored on-chain. Typically a JSON file describing the agent.',
    }),
    description: z.string().min(1).max(2048),
    services: z.array(AgentServiceSchema).optional(),
    registrations: z.array(AgentRegistrationSchema).optional(),
    supported_trust: z.array(z.string()).optional(),
    type: z.string().min(1).max(64).optional().openapi({
      description: "On-chain `type` field; defaults to 'agent'.",
    }),
    receipts_url: z
      .union([z.string().url(), z.literal(false)])
      .optional()
      .openapi({
        description:
          "Override the auto-injected `services[name='receipts']` entry. Pass `false` to skip injection entirely (self-hosters that don't run the Leash API).",
      }),
    client_reference: z.string().max(256).optional(),
  })
  .openapi('CreateAgentBody');

const CreateAgentEcho = z
  .object({
    asset_address: PubkeySchema,
    treasury: PubkeySchema,
    blockhash: z.string(),
    last_valid_block_height: z.number().int().optional(),
  })
  .openapi('CreateAgentEcho');

const TreasuryBalancesSchema = z.object({
  agent_asset: PubkeySchema,
  network: NetworkSchema,
  treasury: PubkeySchema,
  sol: z.object({
    lamports: z.string(),
    sol: z.number(),
    spendable_lamports: z.string(),
    spendable_sol: z.number(),
  }),
  spl: z.array(
    z.object({
      mint: PubkeySchema,
      symbol: z.string().nullable(),
      ata: PubkeySchema,
      token_program: PubkeySchema,
      amount: z.string(),
      decimals: z.number().int().min(0).max(255),
      ui_amount: z.number(),
    }),
  ),
});

export function buildAgentRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/prepare',
      tags: ['agents'],
      summary: 'Mint a new agent (HTTP twin of registry-utils `prepareAgentMint`).',
      description:
        'Calls the Metaplex Agents API under the hood, hands back an unsigned ' +
        'transaction the wallet signs and submits via `POST /v1/submit`, and ' +
        'pre-registers the asset + treasury PDA on the indexer watchlist so the ' +
        'explorer shows the new agent the moment the tx lands.',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: CreateAgentBody } },
        },
      },
      responses: {
        200: {
          description: 'Prepared agent-mint transaction.',
          content: {
            'application/json': { schema: PreparedEnvelopeOpenApi(CreateAgentEcho) },
          },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        502: {
          description: 'Upstream Metaplex API error.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const network = c.var.network;
      const apiKey = c.var.apiKey;
      const umi = umiReadOnly(deps.config, network);

      let prepared: Awaited<ReturnType<typeof prepareAgentMint>>;
      try {
        prepared = await prepareAgentMint(umi, {
          wallet: body.wallet,
          network,
          name: body.name,
          uri: body.uri,
          description: body.description,
          ...(body.services ? { services: body.services } : {}),
          ...(body.registrations
            ? {
                registrations: body.registrations.map((r) => ({
                  agentId: r.agent_id,
                  agentRegistry: r.agent_registry,
                })),
              }
            : {}),
          ...(body.supported_trust ? { supportedTrust: body.supported_trust } : {}),
          ...(body.type ? { type: body.type } : {}),
          ...(body.receipts_url !== undefined ? { receiptsUrl: body.receipts_url } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw internal('metaplex agent mint failed', message);
      }

      // The Metaplex API hands us back a fully-built Umi `Transaction`
      // with the blockhash baked in — we don't need to refresh it. Pull
      // `lastValidBlockHeight` off the response so SDKs can size their
      // confirmation window correctly.
      const lastValidBlockHeight =
        typeof prepared.blockhash.lastValidBlockHeight === 'bigint'
          ? Number(prepared.blockhash.lastValidBlockHeight)
          : prepared.blockhash.lastValidBlockHeight;
      const wire = serializeTransaction(umi, prepared.transaction, lastValidBlockHeight);

      // Derive the treasury PDA up-front so the watchlist row covers
      // both the asset address (rare on-chain churn) and the treasury
      // PDA (where the seller-kit will land payments).
      let treasuryAddress: string;
      try {
        const [treasury] = findAssetSignerPda(umi, {
          asset: publicKey(prepared.assetAddress),
        });
        treasuryAddress = String(treasury);
      } catch (err) {
        throw internal(
          'failed to derive treasury PDA for new agent',
          err instanceof Error ? err.message : String(err),
        );
      }

      const eventId = await createPreparedEvent(deps.db, {
        kind: 'agent.create',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: prepared.assetAddress,
        metadata: {
          owner: body.wallet,
          name: body.name,
          uri: body.uri,
          treasury: treasuryAddress,
        },
      });

      // Best-effort: the agent doesn't exist on chain yet, but adding
      // it to the watchlist now means the indexer will pick up the
      // mint as soon as the caller submits the signed tx.
      try {
        await ensureWatched(deps.db, {
          network,
          agentAsset: prepared.assetAddress,
          treasuryAddress,
        });
      } catch {
        // intentionally swallowed
      }

      return c.json(
        {
          event_id: eventId,
          network,
          transaction: wire,
          echo: {
            asset_address: prepared.assetAddress,
            treasury: treasuryAddress,
            blockhash: prepared.blockhash.blockhash,
            ...(lastValidBlockHeight !== undefined
              ? { last_valid_block_height: lastValidBlockHeight }
              : {}),
          },
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agents/{mint}',
      tags: ['agents'],
      summary: 'Identity, treasury, and token-association summary.',
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'Agent summary.',
          content: { 'application/json': { schema: AgentSummarySchema } },
        },
        502: {
          description: 'RPC error.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const network = c.var.network;
      const umi = umiReadOnly(deps.config, network);
      const summary = await getAgentSummary(umi, network, mint);
      return c.json(summary, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agents/{mint}/treasury/balances',
      tags: ['agents', 'treasury'],
      summary: 'Native SOL + SPL token balances on the agent treasury PDA.',
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'Treasury balance snapshot.',
          content: { 'application/json': { schema: TreasuryBalancesSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const network = c.var.network;
      const umi = umiReadOnly(deps.config, network);
      const balances = await getAgentTreasuryBalances(umi, network, mint);
      // Side-effect: every time someone reads an agent's treasury,
      // make sure the indexer is watching the PDA + every ATA we just
      // surfaced. This is the cheapest path to "explorer auto-detects
      // a deposit to an agent the API has never written to" without
      // forcing the caller to hit a prepare endpoint first.
      try {
        await ensureWatched(deps.db, {
          network,
          agentAsset: balances.agent_asset,
          treasuryAddress: balances.treasury,
        });
        for (const row of balances.spl) {
          await ensureWatchedAta(deps.db, {
            network,
            agentAsset: balances.agent_asset,
            ataAddress: row.ata,
          });
        }
      } catch {
        // Best-effort.
      }
      return c.json(balances, 200);
    },
  );

  return app;
}
