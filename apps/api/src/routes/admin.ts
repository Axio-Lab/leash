/**
 * Admin endpoints for API key issuance.
 *
 * Mounted only when `LEASH_API_ADMIN_SECRET` is configured (see
 * `server.ts`). All requests must carry the secret as
 * `Authorization: Bearer <secret>` or `X-Admin-Secret`.
 *
 * Endpoints:
 *   POST   /v1/admin/api-keys                - issue a new key
 *   GET    /v1/admin/api-keys                - list (no plaintext)
 *   POST   /v1/admin/api-keys/{id}/disable   - revoke
 *
 * The plaintext value is returned EXACTLY ONCE on creation. After
 * that only `prefix` + `last4` are recoverable.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { adminAuth } from '../auth/admin.js';
import { markKeyRevoked } from '../auth/api-key.js';
import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, PubkeySchema } from '../openapi/common.js';
import type { CacheClient } from '../storage/redis.js';
import {
  createApiKey,
  disableApiKey,
  getApiKeyById,
  listApiKeys,
  normalizeOwnerWallet,
  revealApiKeyPlaintext,
} from '../storage/api-keys.js';
import type { DbClient } from '../storage/turso.js';
import { invalidRequest, notFound } from '../util/errors.js';

const NetworkSchema = z.enum(['solana-devnet', 'solana-mainnet']);

const ScopeSchema = z.enum(['agents', 'marketplace', 'admin']);

const ApiKeyRecordSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    network: NetworkSchema,
    prefix: z.string(),
    last4: z.string(),
    owner_wallet: z.string().nullable().openapi({
      description:
        'Solana wallet (base58) this key is attributed to; null for keys created before owner tracking or bootstrap keys.',
    }),
    scopes: z.array(ScopeSchema).nullable().openapi({
      description:
        'Surface scopes for platform-issued keys (agents, marketplace, admin). null for legacy / unrestricted keys.',
    }),
    created_at: z.string(),
    disabled_at: z.string().nullable(),
  })
  .openapi('AdminApiKeyRecord');

const CreateApiKeyBody = z
  .object({
    label: z.string().min(1).max(120),
    network: NetworkSchema,
    owner_wallet: PubkeySchema.openapi({
      description:
        'Solana wallet (base58) of the customer who owns this key — required on every new issuance.',
    }),
    scopes: z.array(ScopeSchema).optional().openapi({
      description:
        'Optional surface scopes (`agents`, `marketplace`, `admin`). Omit for unrestricted keys.',
    }),
  })
  .openapi('AdminCreateApiKeyBody');

const CreateApiKeyResponse = z
  .object({
    key: ApiKeyRecordSchema,
    plaintext: z.string().openapi({
      description: 'Raw key value. Returned ONCE; the server never stores it.',
    }),
  })
  .openapi('AdminCreateApiKeyResponse');

type AdminApiScope = z.infer<typeof ScopeSchema>;

function narrowScopes(scopes: string[] | null): AdminApiScope[] | null {
  if (scopes == null) return null;
  const allowed: AdminApiScope[] = ['agents', 'marketplace', 'admin'];
  const filtered = scopes.filter((s): s is AdminApiScope => (allowed as string[]).includes(s));
  return filtered;
}

function recordToWire(r: Awaited<ReturnType<typeof getApiKeyById>>) {
  if (!r) return null;
  return {
    id: r.id,
    label: r.label,
    network: r.network,
    prefix: r.prefix,
    last4: r.last4,
    owner_wallet: r.ownerWallet,
    scopes: narrowScopes(r.scopes),
    created_at: r.createdAt,
    disabled_at: r.disabledAt,
  };
}

export type AdminDeps = { config: LeashApiConfig; db: DbClient; cache: CacheClient };

export function buildAdminRoutes(deps: AdminDeps): OpenAPIHono {
  // Routes are always registered so they appear in `/openapi.json` and
  // Swagger UI. The middleware returns 503 if no admin secret is
  // configured on this server (see auth/admin.ts).
  const app = new OpenAPIHono();
  app.use('/v1/admin/*', adminAuth(deps.config.adminSecret));

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/admin/api-keys',
      tags: ['admin'],
      summary: 'Issue a new API key',
      security: [{ AdminSecret: [] }],
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: CreateApiKeyBody } },
        },
      },
      responses: {
        200: {
          description: 'Key created. `plaintext` is returned only here.',
          content: { 'application/json': { schema: CreateApiKeyResponse } },
        },
        401: {
          description: 'Missing or invalid admin secret',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        422: {
          description: 'Invalid body',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      let result;
      try {
        const ownerWallet = normalizeOwnerWallet(body.owner_wallet);
        if (ownerWallet == null) {
          throw new Error('owner_wallet: invalid Solana address');
        }
        result = await createApiKey(deps.db, {
          label: body.label,
          network: body.network,
          ownerWallet,
          ...(body.scopes && body.scopes.length > 0 ? { scopes: body.scopes } : {}),
          ...(deps.config.encryptionKey ? { encryptionKey: deps.config.encryptionKey } : {}),
        });
      } catch (err) {
        throw invalidRequest((err as Error).message);
      }
      return c.json({ key: recordToWire(result.key)!, plaintext: result.plaintext }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/admin/api-keys',
      tags: ['admin'],
      summary: 'List issued API keys (no plaintext)',
      security: [{ AdminSecret: [] }],
      request: {
        query: z.object({
          network: NetworkSchema.optional(),
          owner_wallet: z.string().min(32).max(44).optional().openapi({
            description: 'When set, only keys issued for this Solana wallet (canonical base58).',
          }),
          include_disabled: z
            .enum(['true', 'false'])
            .optional()
            .openapi({ description: 'Default false.' }),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      },
      responses: {
        200: {
          description: 'Issued keys, newest first.',
          content: {
            'application/json': {
              schema: z.object({ items: z.array(ApiKeyRecordSchema) }),
            },
          },
        },
        401: {
          description: 'Missing or invalid admin secret',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      let ownerWalletFilter: string | undefined;
      if (q.owner_wallet !== undefined) {
        try {
          const w = normalizeOwnerWallet(q.owner_wallet);
          ownerWalletFilter = w ?? undefined;
        } catch {
          throw invalidRequest('owner_wallet: invalid Solana address');
        }
      }
      const rows = await listApiKeys(deps.db, {
        ...(q.network ? { network: q.network } : {}),
        ...(ownerWalletFilter ? { ownerWallet: ownerWalletFilter } : {}),
        includeDisabled: q.include_disabled === 'true',
        ...(q.limit ? { limit: q.limit } : {}),
      });
      return c.json({ items: rows.map((r) => recordToWire(r)!) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/admin/api-keys/{id}/disable',
      tags: ['admin'],
      summary: 'Disable (revoke) an API key',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
      },
      responses: {
        200: {
          description: 'Disabled. Future requests with this key return 401.',
          content: { 'application/json': { schema: z.object({ key: ApiKeyRecordSchema }) } },
        },
        401: {
          description: 'Missing or invalid admin secret',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        404: {
          description: 'No such key',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const existing = await getApiKeyById(deps.db, id);
      if (!existing) throw notFound('api key not found');
      await disableApiKey(deps.db, id);
      // Beat any still-warm key cache (KEY_CACHE_TTL_SEC = 60) so the
      // revoke is effective immediately, not on cache expiry.
      await markKeyRevoked(deps.cache, id);
      const after = await getApiKeyById(deps.db, id);
      return c.json({ key: recordToWire(after)! }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/admin/api-keys/{id}/reveal',
      tags: ['admin'],
      summary: 'Reveal the plaintext value of a previously-issued key',
      description:
        'Returns the AES-GCM-decrypted plaintext for an api key. Only available for keys created on schema v10+ (rows minted earlier are hash-only).',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
      },
      responses: {
        200: {
          description: 'Decrypted key.',
          content: {
            'application/json': {
              schema: z.object({
                plaintext: z.string(),
              }),
            },
          },
        },
        401: {
          description: 'Missing or invalid admin secret',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        404: {
          description: 'No such key',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        409: {
          description:
            'Key cannot be revealed (legacy hash-only row, or server is missing ENCRYPTION_KEY).',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const existing = await getApiKeyById(deps.db, id);
      if (!existing) throw notFound('api key not found');
      if (!deps.config.encryptionKey) {
        throw invalidRequest('ENCRYPTION_KEY is not configured on the server');
      }
      const plaintext = revealApiKeyPlaintext(existing, deps.config.encryptionKey);
      if (!plaintext) {
        throw invalidRequest(
          'this key was issued before encrypted-at-rest plaintext was supported and cannot be revealed; revoke and re-issue a fresh key.',
        );
      }
      return c.json({ plaintext }, 200);
    },
  );

  return app;
}
