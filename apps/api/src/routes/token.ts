/**
 * Agent → token association prepare route. Wraps `prepareSetAgentToken`.
 *
 * The full Genesis launch flow (`prepareAgentTokenLaunch`) is API-bound
 * to `https://api.metaplex.com` and returns multiple transactions in a
 * bundle; we'll add it in a follow-up so the v0.1 endpoint surface stays
 * sharp around the in-house `mpl-core::Execute` shape.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { prepareSetAgentToken } from '@leash/registry-utils';
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
} from '../openapi/common.js';

const echo = z.object({
  agent_asset: PubkeySchema,
  genesis_account: PubkeySchema,
});

export function buildTokenRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/token/set/prepare',
      tags: ['agents', 'token'],
      summary:
        'Build an unsigned `mpl-core::Execute(setAgentTokenV1)` transaction. Irreversible once submitted.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                genesis_account: PubkeySchema,
                collection: PubkeySchema.optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction.',
          content: { 'application/json': { schema: PreparedEnvelopeOpenApi(echo) } },
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
      const prepared = await prepareSetAgentToken(umi, {
        agentAsset: publicKey(mint),
        genesisAccount: publicKey(body.genesis_account),
        ...(body.collection ? { collection: publicKey(body.collection) } : {}),
      });
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.token.set',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        builder: prepared.builder,
        echo: {
          agent_asset: prepared.agentAsset,
          genesis_account: prepared.genesisAccount,
        },
      });
      return c.json(result, 200);
    },
  );

  return app;
}
