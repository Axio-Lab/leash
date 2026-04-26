/**
 * SPL spend-delegation prepare routes.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { applyFeeGrossUp, resolveLeashFeeBps } from '@leash/core';
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
    /**
     * The actual atomic amount the executive will be approved for. May
     * differ from the request `amount` when `pad_for_protocol_fee=true`
     * — see the body schema for the gross-up math.
     */
    delegated_amount: z.string(),
    /**
     * The Leash protocol fee (atoms) baked into `delegated_amount` when
     * the request opted into padding. `0` for un-padded approvals so the
     * caller can tell the two cases apart without re-doing the math.
     */
    fee_padding_atoms: z.string(),
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
                /**
                 * When `true`, the API gross-ups the requested `amount`
                 * by the current Leash protocol fee rate before building
                 * the SPL Approve. Use this on agent-creation flows so
                 * the executive's allowance covers both the seller's net
                 * leg AND the fee leg of every x402 call up to that
                 * budget. Defaults to `false` for back-compat with
                 * pre-fee callers.
                 */
                pad_for_protocol_fee: z.boolean().optional(),
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
      const requested = BigInt(body.amount);
      // Optionally gross-up the executive's allowance so it covers both
      // the seller's net leg AND the Leash protocol fee leg on every
      // x402 settlement, up to the requested budget. Without padding
      // an agent set to e.g. `5 USDC` would fail the very last call
      // because the fee leg pushes the gross past the cap.
      const padding =
        body.pad_for_protocol_fee === true
          ? applyFeeGrossUp(requested, resolveLeashFeeBps()).fee
          : 0n;
      const amount = requested + padding;
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
          fee_padding_atoms: padding.toString(),
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
