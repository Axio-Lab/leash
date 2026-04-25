/**
 * Treasury prepare routes — provision ATAs, withdraw SPL, withdraw SOL.
 * Mirrors `prepareProvisionTreasuryAtas`, `prepareWithdrawTreasury(All)`,
 * and `prepareWithdrawTreasurySol(All)` from `@leash/registry-utils`.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  prepareProvisionTreasuryAtas,
  prepareWithdrawTreasury,
  prepareWithdrawTreasuryAll,
  prepareWithdrawTreasurySol,
  prepareWithdrawTreasurySolAll,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@leash/registry-utils';
import { publicKey } from '@metaplex-foundation/umi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { umiForRequest } from '../util/umi.js';
import { wrapNoOp, wrapPrepared } from '../util/prepare.js';
import { ensureWatchedAta } from '../indexer/watchlist.js';
import {
  ApiErrorSchema,
  PreparedEnvelopeOpenApi,
  PreparedNoOpEnvelopeOpenApi,
  PubkeySchema,
  SignerOptionsSchema,
  TokenProgramFlavorSchema,
} from '../openapi/common.js';

function tokenProgramFromFlavor(flavor?: 'spl' | 'token-2022') {
  return flavor === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
}

const provisionEntrySchema = z.object({
  mint: PubkeySchema,
  symbol: z.string().optional(),
  address: PubkeySchema,
  token_program: PubkeySchema,
  created: z.boolean(),
});

const provisionEcho = z.object({
  treasury: PubkeySchema,
  atas: z.array(provisionEntrySchema),
});

const withdrawEcho = z.object({
  treasury: PubkeySchema,
  source_token_account: PubkeySchema,
  destination_token_account: PubkeySchema,
  amount: z.string(),
  destination: PubkeySchema,
  will_create_destination_ata: z.boolean(),
  decimals: z.number().int().min(0).max(255),
});

const withdrawSolEcho = z.object({
  treasury: PubkeySchema,
  destination: PubkeySchema,
  lamports: z.string(),
});

export function buildTreasuryRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/treasury/provision/prepare',
      tags: ['agents', 'treasury'],
      summary: 'Build an unsigned `CreateIdempotent` bundle for missing ATAs.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                mints: z
                  .array(
                    z.object({
                      mint: PubkeySchema,
                      symbol: z.string().optional(),
                      token_program: TokenProgramFlavorSchema.optional(),
                    }),
                  )
                  .optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction (or `no_op: true` when every ATA already exists).',
          content: {
            'application/json': {
              schema: z.union([
                PreparedEnvelopeOpenApi(provisionEcho),
                PreparedNoOpEnvelopeOpenApi(provisionEcho),
              ]),
            },
          },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const network = c.var.network;
      const apiKey = c.var.apiKey;
      const umi = umiForRequest(deps.config, {
        network,
        payer: body.payer,
        ...(body.authority ? { authority: body.authority } : {}),
      });
      const prepared = await prepareProvisionTreasuryAtas(umi, {
        agentAsset: publicKey(mint),
        network,
        ...(body.mints
          ? {
              mints: body.mints.map((m) => ({
                mint: publicKey(m.mint),
                tokenProgram: tokenProgramFromFlavor(m.token_program),
                ...(m.symbol ? { symbol: m.symbol } : {}),
              })),
            }
          : {}),
      });
      const echo = {
        treasury: prepared.treasury,
        atas: prepared.atas.map((a) => ({
          mint: a.mint,
          ...(a.symbol ? { symbol: a.symbol } : {}),
          address: a.address,
          token_program: a.tokenProgram,
          created: a.created,
        })),
      };
      // Add every (existing or to-be-created) ATA to the indexer
      // watchlist so plain SPL deposits to those addresses surface
      // as `agent.treasury.fund` events. Done unconditionally — even
      // on `no_op` — so importing an already-provisioned agent into
      // a fresh API instance still gets the ATA watch rows.
      for (const a of prepared.atas) {
        try {
          await ensureWatchedAta(deps.db, {
            network,
            agentAsset: mint,
            ataAddress: String(a.address),
          });
        } catch {
          // Best-effort — a single failed insert shouldn't block the
          // user's prepare call.
        }
      }
      if (prepared.builder == null) {
        return c.json(wrapNoOp({ network, echo }), 200);
      }
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.treasury.provision',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        builder: prepared.builder,
        echo,
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/treasury/withdraw/prepare',
      tags: ['agents', 'treasury'],
      summary: 'Build an unsigned `TransferChecked` (SPL withdraw) transaction.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                spl_mint: PubkeySchema,
                destination: PubkeySchema,
                amount: z.string().regex(/^\d+$/),
                token_program: TokenProgramFlavorSchema.optional(),
                create_destination_ata_if_missing: z.boolean().optional(),
                decimals: z.number().int().min(0).max(255).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction.',
          content: { 'application/json': { schema: PreparedEnvelopeOpenApi(withdrawEcho) } },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const network = c.var.network;
      const apiKey = c.var.apiKey;
      const umi = umiForRequest(deps.config, {
        network,
        payer: body.payer,
        ...(body.authority ? { authority: body.authority } : {}),
      });
      const amount = BigInt(body.amount);
      const prepared = await prepareWithdrawTreasury(umi, {
        agentAsset: publicKey(mint),
        mint: publicKey(body.spl_mint),
        destination: publicKey(body.destination),
        amount,
        tokenProgram: tokenProgramFromFlavor(body.token_program),
        ...(body.create_destination_ata_if_missing != null
          ? { createDestinationAtaIfMissing: body.create_destination_ata_if_missing }
          : {}),
        ...(body.decimals != null ? { decimals: body.decimals } : {}),
      });
      try {
        await ensureWatchedAta(deps.db, {
          network,
          agentAsset: mint,
          ataAddress: String(prepared.sourceTokenAccount),
        });
      } catch {
        // Best-effort.
      }
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.treasury.withdraw',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        mint: body.spl_mint,
        amountAtomic: amount,
        builder: prepared.builder,
        echo: {
          treasury: prepared.treasury,
          source_token_account: prepared.sourceTokenAccount,
          destination_token_account: prepared.destinationTokenAccount,
          amount: prepared.amount.toString(),
          destination: prepared.destination,
          will_create_destination_ata: prepared.willCreateDestinationAta,
          decimals: prepared.decimals,
        },
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/treasury/withdraw-all/prepare',
      tags: ['agents', 'treasury'],
      summary:
        'Build an unsigned SPL "withdraw everything" transaction. Returns `no_op` when balance is zero.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                spl_mint: PubkeySchema,
                destination: PubkeySchema,
                token_program: TokenProgramFlavorSchema.optional(),
                create_destination_ata_if_missing: z.boolean().optional(),
                decimals: z.number().int().min(0).max(255).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction or `no_op`.',
          content: {
            'application/json': {
              schema: z.union([
                PreparedEnvelopeOpenApi(withdrawEcho),
                PreparedNoOpEnvelopeOpenApi(z.object({ treasury: PubkeySchema.optional() })),
              ]),
            },
          },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const network = c.var.network;
      const apiKey = c.var.apiKey;
      const umi = umiForRequest(deps.config, {
        network,
        payer: body.payer,
        ...(body.authority ? { authority: body.authority } : {}),
      });
      const prepared = await prepareWithdrawTreasuryAll(umi, {
        agentAsset: publicKey(mint),
        mint: publicKey(body.spl_mint),
        destination: publicKey(body.destination),
        tokenProgram: tokenProgramFromFlavor(body.token_program),
        ...(body.create_destination_ata_if_missing != null
          ? { createDestinationAtaIfMissing: body.create_destination_ata_if_missing }
          : {}),
        ...(body.decimals != null ? { decimals: body.decimals } : {}),
      });
      if (prepared == null) {
        return c.json(wrapNoOp({ network, echo: {} }), 200);
      }
      try {
        await ensureWatchedAta(deps.db, {
          network,
          agentAsset: mint,
          ataAddress: String(prepared.sourceTokenAccount),
        });
      } catch {
        // Best-effort.
      }
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.treasury.withdraw',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        mint: body.spl_mint,
        amountAtomic: prepared.amount,
        builder: prepared.builder,
        echo: {
          treasury: prepared.treasury,
          source_token_account: prepared.sourceTokenAccount,
          destination_token_account: prepared.destinationTokenAccount,
          amount: prepared.amount.toString(),
          destination: prepared.destination,
          will_create_destination_ata: prepared.willCreateDestinationAta,
          decimals: prepared.decimals,
        },
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/treasury/withdraw-sol/prepare',
      tags: ['agents', 'treasury'],
      summary: 'Build an unsigned SOL withdraw transaction.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                destination: PubkeySchema,
                lamports: z.string().regex(/^\d+$/),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction.',
          content: { 'application/json': { schema: PreparedEnvelopeOpenApi(withdrawSolEcho) } },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const network = c.var.network;
      const apiKey = c.var.apiKey;
      const umi = umiForRequest(deps.config, {
        network,
        payer: body.payer,
        ...(body.authority ? { authority: body.authority } : {}),
      });
      const lamports = BigInt(body.lamports);
      const prepared = prepareWithdrawTreasurySol(umi, {
        agentAsset: publicKey(mint),
        destination: publicKey(body.destination),
        lamports,
      });
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.treasury.withdraw_sol',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        amountAtomic: lamports,
        builder: prepared.builder,
        echo: {
          treasury: prepared.treasury,
          destination: prepared.destination,
          lamports: prepared.lamports.toString(),
        },
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/treasury/withdraw-sol-all/prepare',
      tags: ['agents', 'treasury'],
      summary:
        'Build an unsigned "withdraw all SOL" transaction. Returns `no_op` when balance is at the safety reserve.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                destination: PubkeySchema,
                reserve_lamports: z.string().regex(/^\d+$/).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction or `no_op`.',
          content: {
            'application/json': {
              schema: z.union([
                PreparedEnvelopeOpenApi(withdrawSolEcho),
                PreparedNoOpEnvelopeOpenApi(z.object({})),
              ]),
            },
          },
        },
        422: {
          description: 'Invalid request.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const network = c.var.network;
      const apiKey = c.var.apiKey;
      const umi = umiForRequest(deps.config, {
        network,
        payer: body.payer,
        ...(body.authority ? { authority: body.authority } : {}),
      });
      const prepared = await prepareWithdrawTreasurySolAll(umi, {
        agentAsset: publicKey(mint),
        destination: publicKey(body.destination),
        ...(body.reserve_lamports ? { reserveLamports: BigInt(body.reserve_lamports) } : {}),
      });
      if (prepared == null) {
        return c.json(wrapNoOp({ network, echo: {} }), 200);
      }
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.treasury.withdraw_sol',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        amountAtomic: prepared.lamports,
        builder: prepared.builder,
        echo: {
          treasury: prepared.treasury,
          destination: prepared.destination,
          lamports: prepared.lamports.toString(),
        },
      });
      return c.json(result, 200);
    },
  );

  return app;
}
