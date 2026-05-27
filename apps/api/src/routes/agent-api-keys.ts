/**
 * Agent-created API-key endpoints.
 *
 * These routes use `X-Leash-Sig` instead of an existing API key so an
 * agent can bootstrap its own `agent`-scoped credential from its executive
 * keypair. The plaintext is returned only on create.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { onChainAuth, type OnChainAuthDeps, type OnChainAuthVariables } from '../auth/onchain.js';
import { markKeyRevoked } from '../auth/api-key.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import {
  createApiKey,
  disableApiKey,
  getApiKeyById,
  listApiKeys,
  type ApiKeyRecord,
} from '../storage/api-keys.js';
import { getPlatformAgent } from '../storage/platform-agents.js';
import { invalidRequest, notFound, unauthorized } from '../util/errors.js';

const AgentScopeSchema = z.literal('agent');

const AgentApiKeySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    network: NetworkSchema,
    prefix: z.string(),
    last4: z.string(),
    owner_wallet: PubkeySchema.openapi({
      description: 'The agent executive public key that created and owns this key.',
    }),
    agent_mint: PubkeySchema.openapi({
      description: 'The Leash agent identity this key belongs to.',
    }),
    scopes: z.array(AgentScopeSchema).openapi({
      description: 'Agent-created keys always carry exactly the `agent` scope.',
    }),
    created_at: z.string(),
    disabled_at: z.string().nullable(),
  })
  .openapi('AgentApiKey');

const CreateAgentApiKeyBody = z
  .object({
    label: z.string().min(1).max(120),
  })
  .openapi('CreateAgentApiKeyBody');

const CreateAgentApiKeyResponse = z
  .object({
    key: AgentApiKeySchema,
    plaintext: z.string().openapi({
      description: 'Raw key value. Returned once on create; store it securely.',
    }),
  })
  .openapi('CreateAgentApiKeyResponse');

export type AgentApiKeyDeps = OnChainAuthDeps & {
  cache: Parameters<typeof markKeyRevoked>[0];
};

export function buildAgentApiKeyRoutes(deps: AgentApiKeyDeps): OpenAPIHono<{
  Variables: OnChainAuthVariables;
}> {
  const app = new OpenAPIHono<{ Variables: OnChainAuthVariables }>();

  app.use('/v1/agents/:mint/api-keys', onChainAuth(deps));
  app.use('/v1/agents/:mint/api-keys/:id/disable', onChainAuth(deps));

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/api-keys',
      tags: ['agents'],
      summary: 'Create an agent-scoped API key (X-Leash-Sig auth).',
      description:
        'The request must be signed by the agent executive keypair. The created key is attributed to the executive as `owner_wallet`, bound to `agent_mint`, and scoped as exactly `agent`.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: { 'application/json': { schema: CreateAgentApiKeyBody } },
        },
      },
      responses: {
        200: {
          description: 'Key created. `plaintext` is returned only here.',
          content: { 'application/json': { schema: CreateAgentApiKeyResponse } },
        },
        401: {
          description: 'On-chain auth failed.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        422: {
          description: 'Invalid body.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      await assertSignedAgent(deps, mint, c.var.agent_mint);
      const body = c.req.valid('json');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');

      let result;
      try {
        result = await createApiKey(deps.db, {
          label: body.label,
          network: agent.network,
          ownerWallet: c.var.executive_pubkey,
          agentMint: mint,
          scopes: ['agent'],
        });
      } catch (err) {
        throw invalidRequest((err as Error).message);
      }

      return c.json({ key: recordToWire(result.key), plaintext: result.plaintext }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agents/{mint}/api-keys',
      tags: ['agents'],
      summary: 'List agent-scoped API keys for the signing agent.',
      request: {
        params: z.object({ mint: PubkeySchema }),
        query: z.object({
          include_disabled: z
            .enum(['true', 'false'])
            .optional()
            .openapi({ description: 'Default false.' }),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
      responses: {
        200: {
          description: 'Agent API keys, newest first. Plaintext is never included.',
          content: {
            'application/json': {
              schema: z.object({ items: z.array(AgentApiKeySchema) }),
            },
          },
        },
        401: {
          description: 'On-chain auth failed.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      await assertSignedAgent(deps, mint, c.var.agent_mint);
      const q = c.req.valid('query');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      const rows = await listApiKeys(deps.db, {
        network: agent.network,
        agentMint: mint,
        includeDisabled: q.include_disabled === 'true',
        ...(q.limit ? { limit: q.limit } : {}),
      });
      return c.json({ items: rows.map(recordToWire) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agents/{mint}/api-keys/{id}/disable',
      tags: ['agents'],
      summary: 'Disable an agent-scoped API key for the signing agent.',
      request: {
        params: z.object({ mint: PubkeySchema, id: z.string().min(1) }),
      },
      responses: {
        200: {
          description: 'Disabled. Future requests with this key return 401.',
          content: { 'application/json': { schema: z.object({ key: AgentApiKeySchema }) } },
        },
        401: {
          description: 'On-chain auth failed.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        404: {
          description: 'No such agent key.',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint, id } = c.req.valid('param');
      await assertSignedAgent(deps, mint, c.var.agent_mint);
      const existing = await getApiKeyById(deps.db, id);
      if (!existing || existing.agentMint !== mint || !isAgentScoped(existing)) {
        throw notFound('api key not found');
      }
      await disableApiKey(deps.db, id);
      await markKeyRevoked(deps.cache, id);
      const after = await getApiKeyById(deps.db, id);
      if (!after) throw notFound('api key not found');
      return c.json({ key: recordToWire(after) }, 200);
    },
  );

  return app;
}

async function assertSignedAgent(
  deps: AgentApiKeyDeps,
  mint: string,
  signedMint: string,
): Promise<void> {
  if (mint !== signedMint) {
    throw unauthorized('X-Leash-Agent must equal :mint path param');
  }
  const agent = await getPlatformAgent(deps.db, mint);
  if (!agent) throw notFound('agent not found');
}

function isAgentScoped(record: ApiKeyRecord): boolean {
  return record.scopes?.length === 1 && record.scopes[0] === 'agent';
}

function recordToWire(record: ApiKeyRecord): z.infer<typeof AgentApiKeySchema> {
  if (!record.ownerWallet || !record.agentMint || !isAgentScoped(record)) {
    throw invalidRequest('api key is not an agent-scoped key');
  }
  return {
    id: record.id,
    label: record.label,
    network: record.network,
    prefix: record.prefix,
    last4: record.last4,
    owner_wallet: record.ownerWallet,
    agent_mint: record.agentMint,
    scopes: ['agent'],
    created_at: record.createdAt,
    disabled_at: record.disabledAt,
  };
}
