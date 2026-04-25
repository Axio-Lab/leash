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

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { umiReadOnly } from '../util/umi.js';
import { getAgentSummary, getAgentTreasuryBalances } from '../util/agent-snapshot.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import { ensureWatched, ensureWatchedAta } from '../indexer/watchlist.js';

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
