/**
 * Agent identity registration. Wraps `prepareRegisterAgentIdentity`.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { prepareRegisterAgentIdentity } from '@leashmarket/registry-utils';
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

export function buildIdentityRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  const echo = z.object({
    asset: PubkeySchema,
    collection: PubkeySchema,
    agent_registration_uri: z.string(),
  });

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/identity/prepare',
      tags: ['agents', 'identity'],
      summary: 'Build an unsigned `registerIdentityV1` transaction.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                collection: PubkeySchema,
                agent_registration_uri: z.string().url(),
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
      const prepared = await prepareRegisterAgentIdentity(umi, {
        asset: publicKey(mint),
        collection: publicKey(body.collection),
        agentRegistrationUri: body.agent_registration_uri,
      });
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.identity.register',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        builder: prepared.builder,
        echo: {
          asset: prepared.asset,
          collection: prepared.collection,
          agent_registration_uri: prepared.agentRegistrationUri,
        },
      });
      return c.json(result, 200);
    },
  );

  return app;
}
