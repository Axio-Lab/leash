/**
 * Executive lifecycle routes:
 *   - register an executive profile (one-time per wallet)
 *   - delegate execution of an agent to that executive
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { prepareDelegateExecution, prepareRegisterExecutive } from '@leash/registry-utils';
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

export function buildExecutiveRoutes(deps: {
  config: LeashApiConfig;
  db: DbClient;
}): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  const registerEcho = z.object({ profile: PubkeySchema });

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/executive/register/prepare',
      tags: ['agents', 'executive'],
      summary: 'Build an unsigned `registerExecutiveV1` transaction.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: { 'application/json': { schema: SignerOptionsSchema } },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction.',
          content: { 'application/json': { schema: PreparedEnvelopeOpenApi(registerEcho) } },
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
      const prepared = await prepareRegisterExecutive(umi);
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.executive.register',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        builder: prepared.builder,
        echo: { profile: prepared.profile },
      });
      return c.json(result, 200);
    },
  );

  const delegateEcho = z.object({
    delegate_record: PubkeySchema,
    agent_asset: PubkeySchema,
    agent_identity: PubkeySchema,
    executive_profile: PubkeySchema,
  });

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/executive/delegate/prepare',
      tags: ['agents', 'executive'],
      summary: 'Build an unsigned `delegateExecutionV1` transaction.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: SignerOptionsSchema.extend({
                executive_authority: PubkeySchema,
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prepared transaction.',
          content: { 'application/json': { schema: PreparedEnvelopeOpenApi(delegateEcho) } },
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
      const prepared = await prepareDelegateExecution(umi, {
        agentAsset: publicKey(mint),
        executiveAuthority: publicKey(body.executive_authority),
      });
      const result = await wrapPrepared({
        db: deps.db,
        umi,
        kind: 'agent.executive.delegate',
        network,
        apiKeyId: apiKey.id,
        clientReference: body.client_reference ?? c.var.clientReference ?? null,
        agentAsset: mint,
        builder: prepared.builder,
        echo: {
          delegate_record: prepared.delegateRecord,
          agent_asset: prepared.agentAsset,
          agent_identity: prepared.agentIdentity,
          executive_profile: prepared.executiveProfile,
        },
      });
      return c.json(result, 200);
    },
  );

  return app;
}
