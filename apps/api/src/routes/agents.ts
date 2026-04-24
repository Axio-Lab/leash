/**
 * Read-side endpoints for an agent: identity + treasury balances.
 *
 * Network is bound to the caller's API key, so calling
 * `GET /v1/agents/{mint}` with a `lsh_test_*` key always reads from
 * devnet, even if `mint` exists on mainnet too.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  getAgentToken,
  getTreasurySolBalance,
  KNOWN_STABLES,
  type AgentTokenStatus,
  type TreasurySolBalance,
} from '@leash/registry-utils';
import {
  safeFetchAgentIdentityV1FromSeeds,
  safeFetchAgentIdentityV2FromSeeds,
} from '@metaplex-foundation/mpl-agent-registry';
import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import { publicKey, type Umi } from '@metaplex-foundation/umi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { umiReadOnly } from '../util/umi.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';

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
      const asset = publicKey(mint);
      const [treasury] = findAssetSignerPda(umi, { asset });
      const v2 = await safeFetchAgentIdentityV2FromSeeds(umi, { asset });
      const v1 = v2 == null ? await safeFetchAgentIdentityV1FromSeeds(umi, { asset }) : null;
      const identity =
        v2 != null
          ? { source: 'v2' as const, asset: String(v2.asset) }
          : v1 != null
            ? { source: 'v1' as const, asset: String(v1.asset) }
            : null;
      const tokenStatus: AgentTokenStatus = await getAgentToken(umi, asset);
      return c.json(
        {
          agent_asset: mint,
          network,
          treasury: String(treasury),
          has_identity: identity != null,
          identity,
          token: {
            has_token: tokenStatus.hasToken,
            mint: tokenStatus.mint,
            source: tokenStatus.source,
          },
        },
        200,
      );
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
      const asset = publicKey(mint);
      const sol: TreasurySolBalance = await getTreasurySolBalance(umi, { agentAsset: asset });
      const splBalances = await readKnownSplBalances(umi, network, asset);
      return c.json(
        {
          agent_asset: mint,
          network,
          treasury: sol.treasury,
          sol: {
            lamports: sol.lamports.toString(),
            sol: sol.sol,
            spendable_lamports: sol.spendableLamports.toString(),
            spendable_sol: sol.spendableSol,
          },
          spl: splBalances,
        },
        200,
      );
    },
  );

  return app;
}

async function readKnownSplBalances(
  umi: Umi,
  network: 'solana-devnet' | 'solana-mainnet',
  asset: ReturnType<typeof publicKey>,
) {
  const [treasury] = findAssetSignerPda(umi, { asset });
  const stables = KNOWN_STABLES[network];
  const out = [] as Array<{
    mint: string;
    symbol: string | null;
    ata: string;
    token_program: string;
    amount: string;
    decimals: number;
    ui_amount: number;
  }>;
  for (const s of stables) {
    const [ata] = findAssociatedTokenPda(umi, {
      mint: s.mint,
      owner: treasury,
      tokenProgramId: s.tokenProgram,
    });
    let amount = 0n;
    let decimals = 6;
    try {
      const acc = await umi.rpc.getAccount(ata);
      if (acc.exists && acc.data.length >= 72) {
        const dv = new DataView(acc.data.buffer, acc.data.byteOffset, acc.data.byteLength);
        amount = dv.getBigUint64(64, true);
      }
      const mintAcc = await umi.rpc.getAccount(s.mint);
      if (mintAcc.exists && mintAcc.data.length >= 45) {
        decimals = mintAcc.data[44] ?? 6;
      }
    } catch {
      // Network/RPC blip — surface as zero balance, not as a 5xx.
    }
    out.push({
      mint: String(s.mint),
      symbol: s.symbol ?? null,
      ata: String(ata),
      token_program: String(s.tokenProgram),
      amount: amount.toString(),
      decimals,
      ui_amount: Number(amount) / Math.pow(10, decimals),
    });
  }
  return out;
}
