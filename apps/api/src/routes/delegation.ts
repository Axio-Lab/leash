/**
 * SPL spend-delegation prepare routes.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  prepareRevokeSpendDelegation,
  prepareSetSpendDelegation,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@leash/registry-utils';
import { publicKey } from '@metaplex-foundation/umi';

import type { AuthVariables } from '../auth/types.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { umiForRequest } from '../util/umi.js';
import { wrapPrepared } from '../util/prepare.js';
import {
  ApiErrorSchema,
  PreparedEnvelopeOpenApi,
  PubkeySchema,
  SignerOptionsSchema,
  TokenProgramFlavorSchema,
} from '../openapi/common.js';

function tokenProgramFromFlavor(flavor?: 'spl' | 'token-2022') {
  return flavor === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
}

export function buildDelegationRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  const setEcho = z.object({
    treasury: PubkeySchema,
    source_token_account: PubkeySchema,
    delegated_amount: z.string(),
    delegate: PubkeySchema,
    will_create_ata: z.boolean(),
  });

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/delegation/prepare',
      tags: ['agents', 'delegation'],
      summary: 'Build an unsigned SPL `Approve` (spend delegation) transaction.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                spl_mint: PubkeySchema,
                executive: PubkeySchema,
                amount: z.string().regex(/^\d+$/),
                token_program: TokenProgramFlavorSchema.optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction.',
          content: { 'application/json': { schema: PreparedEnvelopeOpenApi(setEcho) } },
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
      const prepared = await prepareSetSpendDelegation(umi, {
        agentAsset: publicKey(mint),
        mint: publicKey(body.spl_mint),
        executive: publicKey(body.executive),
        amount,
        tokenProgram: tokenProgramFromFlavor(body.token_program),
      });
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.delegation.set',
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
          delegated_amount: prepared.delegatedAmount.toString(),
          delegate: prepared.delegate,
          will_create_ata: prepared.willCreateAta,
        },
      });
      return c.json(result, 200);
    },
  );

  const revokeEcho = z.object({
    treasury: PubkeySchema,
    source_token_account: PubkeySchema,
  });

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/delegation/revoke/prepare',
      tags: ['agents', 'delegation'],
      summary: 'Build an unsigned SPL `Revoke` transaction.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                spl_mint: PubkeySchema,
                token_program: TokenProgramFlavorSchema.optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction.',
          content: { 'application/json': { schema: PreparedEnvelopeOpenApi(revokeEcho) } },
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
      const prepared = prepareRevokeSpendDelegation(umi, {
        agentAsset: publicKey(mint),
        mint: publicKey(body.spl_mint),
        tokenProgram: tokenProgramFromFlavor(body.token_program),
      });
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.delegation.revoke',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        mint: body.spl_mint,
        builder: prepared.builder,
        echo: {
          treasury: prepared.treasury,
          source_token_account: prepared.sourceTokenAccount,
        },
      });
      return c.json(result, 200);
    },
  );

  return app;
}
