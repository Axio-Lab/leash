/**
 * `/v1/external/*` — Telegram + WhatsApp bridge surface.
 *
 * The CRUD endpoints are admin-gated (BFF-only, same model as
 * `/v1/platform/agents`): the user authenticates to `apps/agents` with
 * Privy, the BFF translates the session into authenticated calls here.
 *
 * The two public endpoints are:
 *   - `GET /v1/external/approvals/{token}` — the deep-link landing page
 *     in apps/agents reads the pending approval to render the artifact UI.
 *     Only non-secret fields are returned (tool_name, agent_mint, payload,
 *     expires_at, consumed_at) — no bot tokens, no encrypted_credential.
 *   - `POST /v1/external/telegram/webhook/{routing_id}` — Telegram → us.
 *     `routing_id = sha256(bot_token)`, so the URL never carries the
 *     plaintext token through any HTTP middleware. Phase 1 only handles
 *     the `/start <verification_token>` binding step + writes inbound
 *     messages to the audit ledger; routing replies through the agent
 *     runtime is wired up in phase 3.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { decryptSecret, encryptSecret } from '@leash/platform-auth/encryption';

import { adminAuth } from '../auth/admin.js';
import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, PubkeySchema } from '../openapi/common.js';
import {
  bindExternalConnection,
  consumeApproval,
  createApproval,
  createExternalConnection,
  deleteExternalConnection,
  getApproval,
  getConnectionByRoutingId,
  getConnectionByVerificationToken,
  getExternalConnection,
  listExternalConnectionsForOwner,
  newApprovalToken,
  recordExternalMessage,
  refreshVerificationToken,
  routingIdForBotToken,
  updateConnectionAllowlist,
  updateConnectionSigning,
  type ExternalApprovalRow,
  type ExternalConnectionRow,
} from '../storage/external-connections.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import { conflict, invalidRequest, notFound, unavailable } from '../util/errors.js';
import { notifyApprovalSettled } from '../external/approval-settlement-notify.js';
import { dispatchTelegramMessage, type DispatcherDeps } from '../external/telegram-dispatcher.js';
import { createTelegramClient, type TelegramClient } from '../external/telegram-client.js';
import type { WhatsAppManager } from '../external/whatsapp-manager.js';
import { ensureWhatsAppStateRow, getWhatsAppState } from '../storage/external-whatsapp.js';

export type ExternalRoutesDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
  /**
   * Optional dispatcher overrides — used by tests to stub the
   * apps/agents BFF fetch and the Telegram client without monkey-patching
   * `globalThis.fetch`. In production callers leave both unset and the
   * dispatcher uses the real implementations.
   */
  dispatcherBffFetch?: typeof fetch;
  dispatcherTelegramClientFactory?: (botToken: string) => TelegramClient;
  /**
   * Optional WhatsApp session manager. When set, the routes can drive
   * a real (or stubbed) Baileys session — `start`, `getStatus`, `stop`.
   * Operators wire this in `server.ts` only when `LEASH_WHATSAPP_ENABLED=1`
   * because Baileys requires a single replica to avoid duplicated
   * Signal-protocol state.
   */
  whatsapp?: WhatsAppManager;
};

// ── schemas ──────────────────────────────────────────────────────────

const ChannelSchema = z.enum(['telegram', 'whatsapp']);
const StatusSchema = z.enum(['pending', 'connected', 'error', 'revoked']);
const SigningModeSchema = z.enum(['deep_link', 'delegated']);

const ConnectionPublicSchema = z
  .object({
    id: z.string(),
    owner_privy_id: z.string(),
    channel: ChannelSchema,
    status: StatusSchema,
    display_name: z.string().nullable(),
    bot_username: z.string().nullable(),
    routing_id: z.string().nullable().openapi({
      description: 'sha256 of the BYO bot token. Surface as the public webhook path.',
    }),
    verification_token: z.string().nullable().openapi({
      description:
        'One-time token rendered into the deep-link / QR. NULL once the connection is bound.',
    }),
    bound_chat_id: z.string().nullable(),
    allowlist: z.array(z.string()),
    signing_mode: SigningModeSchema,
    cap_per_tx: z.string().nullable(),
    cap_per_day: z.string().nullable(),
    daily_spent: z.string(),
    daily_window_start: z.string().nullable(),
    delegated_pubkey: z.string().nullable(),
    last_seen_at: z.string().nullable(),
    error: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    telegram_webhook_url: z.string().nullable().optional().openapi({
      description:
        'Telegram Bot API webhook URL on this API host (channel=telegram only). Set automatically on create/refresh.',
    }),
  })
  .openapi('ExternalConnection');

const CreateConnectionBody = z
  .object({
    owner_privy_id: z.string().min(1),
    channel: ChannelSchema,
    display_name: z.string().min(1).max(120).optional(),
    bot_token: z
      .string()
      .min(20)
      .max(128)
      .optional()
      .openapi({
        description:
          'Telegram BYO bot token (e.g. `123456:ABC-DEF…`). Required when channel=telegram. ' +
          'Validated upstream by the BFF (calls `getMe`); we encrypt and store it server-side.',
      }),
    bot_username: z.string().min(1).max(64).optional().openapi({
      description: 'Telegram username for the bot (without the `@`). Used to render the deep link.',
    }),
  })
  .superRefine((v, ctx) => {
    if (v.channel === 'telegram' && (!v.bot_token || !v.bot_username)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bot_token'],
        message: 'channel=telegram requires bot_token and bot_username',
      });
    }
  })
  .openapi('CreateExternalConnectionBody');

const UpdateConnectionBody = z
  .object({
    display_name: z.string().min(1).max(120).optional(),
    allowlist: z.array(z.string().min(1).max(128)).max(8).optional(),
    signing_mode: SigningModeSchema.optional(),
    cap_per_tx: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'expected decimal number')
      .optional(),
    cap_per_day: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'expected decimal number')
      .optional(),
    delegated_secret_key_b58: z
      .string()
      .min(32)
      .max(128)
      .optional()
      .openapi({
        description:
          "Base58-encoded secret key for the server-held signer when signing_mode='delegated'. " +
          'Encrypted at rest with the same key as `agents.encrypted_llm_key`.',
      }),
    delegated_pubkey: PubkeySchema.optional().openapi({
      description: 'Base58 pubkey of the delegated signer (informational)',
    }),
  })
  .refine(
    (v) =>
      v.display_name !== undefined ||
      v.allowlist !== undefined ||
      v.signing_mode !== undefined ||
      v.cap_per_tx !== undefined ||
      v.cap_per_day !== undefined ||
      v.delegated_secret_key_b58 !== undefined ||
      v.delegated_pubkey !== undefined,
    'must include at least one updatable field',
  )
  .openapi('UpdateExternalConnectionBody');

const CreateApprovalBody = z
  .object({
    connection_id: z.string().min(1),
    agent_mint: PubkeySchema,
    tool_name: z.string().min(1).max(120),
    payload: z.record(z.unknown()).default({}),
    ttl_ms: z
      .number()
      .int()
      .min(30_000)
      .max(15 * 60 * 1000)
      .optional(),
  })
  .openapi('CreateExternalApprovalBody');

const ConsumeApprovalBody = z
  .object({
    receipt_hash: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'expected sha256 hex')
      .optional(),
    tx_sig: z
      .string()
      .min(43)
      .max(120)
      .optional()
      .openapi({ description: 'Base58 transaction signature on success.' }),
    error: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .openapi({ description: 'Error/cancellation message; mutually exclusive with success.' }),
  })
  .refine(
    (v) => (v.error == null) !== (v.receipt_hash == null && v.tx_sig == null) || v.error == null,
    'provide either success fields or error, not both',
  )
  .openapi('ConsumeExternalApprovalBody');

const ApprovalPublicSchema = z
  .object({
    token: z.string(),
    connection_id: z.string(),
    agent_mint: PubkeySchema,
    tool_name: z.string(),
    payload: z.record(z.unknown()),
    expires_at: z.string(),
    consumed_at: z.string().nullable(),
    result_receipt_hash: z.string().nullable(),
    result_tx_sig: z.string().nullable(),
    result_error: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('ExternalApproval');

// ── helpers ──────────────────────────────────────────────────────────

function getEncryptionKey(config: LeashApiConfig): string {
  if (!config.encryptionKey || config.encryptionKey.length !== 64) {
    throw invalidRequest(
      'server is missing ENCRYPTION_KEY (32-byte hex). external connections cannot store secrets.',
    );
  }
  return config.encryptionKey;
}

function connectionToWire(row: ExternalConnectionRow, config: LeashApiConfig) {
  return {
    id: row.id,
    owner_privy_id: row.ownerPrivyId,
    channel: row.channel,
    status: row.status,
    display_name: row.displayName,
    bot_username: row.botUsername,
    routing_id: row.routingId,
    verification_token: row.verificationToken,
    bound_chat_id: row.boundChatId,
    allowlist: row.allowlist,
    signing_mode: row.signingMode,
    cap_per_tx: row.capPerTx,
    cap_per_day: row.capPerDay,
    daily_spent: row.dailySpent,
    daily_window_start: row.dailyWindowStart,
    delegated_pubkey: row.delegatedPubkey,
    last_seen_at: row.lastSeenAt,
    error: row.error,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    telegram_webhook_url:
      row.channel === 'telegram' && row.routingId
        ? webhookUrlForRouting(config, row.routingId)
        : null,
  };
}

function approvalToWire(row: ExternalApprovalRow) {
  return {
    token: row.token,
    connection_id: row.connectionId,
    agent_mint: row.agentMint,
    tool_name: row.toolName,
    payload: row.payload,
    expires_at: row.expiresAt,
    consumed_at: row.consumedAt,
    result_receipt_hash: row.resultReceiptHash,
    result_tx_sig: row.resultTxSig,
    result_error: row.resultError,
    created_at: row.createdAt,
  };
}

/**
 * Compose the public webhook URL Telegram forwards updates to.
 * `LEASH_API_PUBLIC_ORIGIN` must match where this API is reachable from
 * the public internet (tunnel / prod host) or delivery will fail.
 */
function webhookUrlForRouting(config: LeashApiConfig, routingId: string): string {
  return `${config.publicOrigin}/v1/external/telegram/webhook/${routingId}`;
}

/**
 * Tells Telegram to POST updates to our webhook. Called automatically on
 * create / refresh so operators are not forced through manual curl.
 */
async function registerTelegramWebhook(
  botToken: string,
  webhookUrl: string,
): Promise<{ ok: true } | { ok: false; description: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url: webhookUrl }),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (json.ok) return { ok: true };
    return {
      ok: false,
      description: json.description ?? `Telegram setWebhook failed (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      ok: false,
      description: err instanceof Error ? err.message : 'setWebhook network error',
    };
  }
}

/** URL-safe verification token for the `/start <token>` deep link. */
function newVerificationToken(): string {
  return newApprovalToken();
}

/** Plain-text replies from the webhook (no Markdown — avoids parse errors). */
const TELEGRAM_MSG_WELCOME_CONNECTED =
  "You're connected to Leash.\n\nAsk me anything — I can help with payments, receipts, and your agents.";

const TELEGRAM_MSG_SETUP_HINT =
  'Welcome. To link this chat to your Leash account, open Leash → Settings → External connections, expand this bot, and tap the Authorize link once (then tap Start in Telegram).';

const TELEGRAM_MSG_WELCOME_BACK = "You're all set. What would you like to do?";

/**
 * Fire-and-forget Bot API sendMessage (plain text). Used for /start UX so the
 * user always gets immediate feedback without running the LLM. Errors are
 * swallowed — Telegram outages must not corrupt webhook handling.
 */
function sendTelegramPlainBestEffort(
  config: LeashApiConfig,
  conn: ExternalConnectionRow,
  chatId: string,
  text: string,
): void {
  void (async () => {
    try {
      if (!conn.encryptedCredential) return;
      let encKey: string;
      try {
        encKey = getEncryptionKey(config);
      } catch {
        return;
      }
      const botToken = decryptSecret(conn.encryptedCredential, encKey);
      const tg = createTelegramClient({ botToken });
      await tg.sendMessage({
        chatId,
        text,
        disableWebPagePreview: true,
      });
    } catch {
      // best-effort — never throw out of webhook handlers.
    }
  })();
}

// ── routes ───────────────────────────────────────────────────────────

export function buildExternalRoutes(deps: ExternalRoutesDeps): OpenAPIHono {
  const app = new OpenAPIHono();

  // Admin-gated CRUD surface. Mounted under /v1/external/* with the same
  // adminAuth middleware as platform-* — the apps/agents BFF holds the
  // shared secret, so end users authenticate to the BFF with Privy and
  // the BFF makes admin calls into us. The two public sub-routes
  // (approval read + Telegram webhook) are mounted on a different path
  // prefix below so they don't fall behind this middleware.
  app.use('/v1/external/connections', adminAuth(deps.config.adminSecret));
  app.use('/v1/external/connections/*', adminAuth(deps.config.adminSecret));
  app.use('/v1/external/approvals', adminAuth(deps.config.adminSecret));
  // GET /v1/external/approvals/{token} is intentionally PUBLIC (the
  // deep-link landing page in apps/agents reads it before the user is
  // authenticated). It's mounted on a separate non-authed sub-app
  // below — Hono falls through when no handler in this sub-app
  // matches, so the public sub-app gets first crack at the GET.
  // POST /v1/external/approvals/{token}/consume stays admin-gated:
  // we bracket the consume sub-path with this scoped middleware so
  // the BFF (which has the secret) can call it but anonymous traffic
  // can't. The bare GET still falls through to the public sub-app.
  app.use('/v1/external/approvals/*/consume', adminAuth(deps.config.adminSecret));

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/external/connections',
      tags: ['external'],
      summary: 'Create an external chat connection (Telegram or WhatsApp)',
      security: [{ AdminSecret: [] }],
      request: {
        body: { required: true, content: { 'application/json': { schema: CreateConnectionBody } } },
      },
      responses: {
        200: {
          description: 'Connection created. Includes verification_token + webhook_url.',
          content: {
            'application/json': {
              schema: z.object({
                connection: ConnectionPublicSchema,
                webhook_url: z.string().nullable().openapi({
                  description:
                    'Public URL Telegram posts to (channel=telegram). Usually registered automatically via setWebhook.',
                }),
                deep_link: z.string().nullable().openapi({
                  description:
                    'Telegram `https://t.me/{bot}?start={token}` link (channel=telegram).',
                }),
                telegram_webhook_registered: z.boolean().optional().openapi({
                  description:
                    'True when setWebhook succeeded (telegram only). If false, use telegram_webhook_error + manual steps.',
                }),
                telegram_webhook_error: z.string().nullable().optional().openapi({
                  description:
                    'Telegram API error when automatic setWebhook failed (telegram only).',
                }),
              }),
            },
          },
        },
        422: {
          description: 'invalid',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      let encryptedCredential: string | null = null;
      let routingId: string | null = null;
      let webhookUrl: string | null = null;
      let deepLink: string | null = null;
      const verificationToken = newVerificationToken();
      if (body.channel === 'telegram') {
        const encKey = getEncryptionKey(deps.config);
        encryptedCredential = encryptSecret(body.bot_token!, encKey);
        routingId = routingIdForBotToken(body.bot_token!);
        webhookUrl = webhookUrlForRouting(deps.config, routingId);
        deepLink = `https://t.me/${body.bot_username!}?start=${verificationToken}`;
      }
      const created = await createExternalConnection(deps.db, {
        ownerPrivyId: body.owner_privy_id,
        channel: body.channel,
        displayName: body.display_name ?? null,
        encryptedCredential,
        routingId,
        botUsername: body.bot_username ?? null,
        verificationToken,
        signingMode: 'deep_link',
      });
      // Pre-seed the WhatsApp state row so `manager.start(id)` can
      // begin without an extra `INSERT OR IGNORE` round-trip.
      if (body.channel === 'whatsapp') {
        await ensureWhatsAppStateRow(deps.db, created.id);
      }

      let telegramWebhookRegistered: boolean | undefined;
      let telegramWebhookError: string | null | undefined;
      if (body.channel === 'telegram' && webhookUrl && body.bot_token) {
        const reg = await registerTelegramWebhook(body.bot_token, webhookUrl);
        telegramWebhookRegistered = reg.ok;
        telegramWebhookError = reg.ok ? null : reg.description;
      }

      return c.json(
        {
          connection: connectionToWire(created, deps.config),
          webhook_url: webhookUrl,
          deep_link: deepLink,
          ...(body.channel === 'telegram'
            ? {
                telegram_webhook_registered: telegramWebhookRegistered,
                telegram_webhook_error: telegramWebhookError ?? null,
              }
            : {}),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/external/connections',
      tags: ['external'],
      summary: 'List connections for an owner',
      security: [{ AdminSecret: [] }],
      request: { query: z.object({ owner_privy_id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({ items: z.array(ConnectionPublicSchema) }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { owner_privy_id } = c.req.valid('query');
      const rows = await listExternalConnectionsForOwner(deps.db, owner_privy_id);
      return c.json({ items: rows.map((r) => connectionToWire(r, deps.config)) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/external/connections/{id}',
      tags: ['external'],
      summary: 'Fetch a single connection',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: ConnectionPublicSchema } },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const row = await getExternalConnection(deps.db, id);
      if (!row) throw notFound('connection not found');
      return c.json(connectionToWire(row, deps.config), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/external/connections/{id}',
      tags: ['external'],
      summary: 'Update display_name / allowlist / signing_mode + caps',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ id: z.string().min(1) }),
        body: { required: true, content: { 'application/json': { schema: UpdateConnectionBody } } },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: ConnectionPublicSchema } },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
        422: {
          description: 'invalid',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const existing = await getExternalConnection(deps.db, id);
      if (!existing) throw notFound('connection not found');
      if (body.allowlist !== undefined) {
        await updateConnectionAllowlist(deps.db, id, body.allowlist);
      }
      if (body.display_name !== undefined) {
        await deps.db.execute({
          sql: `UPDATE external_connections SET display_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
          args: [body.display_name, id],
        });
      }
      if (
        body.signing_mode !== undefined ||
        body.cap_per_tx !== undefined ||
        body.cap_per_day !== undefined ||
        body.delegated_secret_key_b58 !== undefined ||
        body.delegated_pubkey !== undefined
      ) {
        const nextMode = body.signing_mode ?? existing.signingMode;
        if (nextMode === 'delegated') {
          if (!body.cap_per_tx || !body.cap_per_day) {
            throw invalidRequest("signing_mode='delegated' requires cap_per_tx + cap_per_day");
          }
          if (!body.delegated_secret_key_b58 || !body.delegated_pubkey) {
            throw invalidRequest(
              "signing_mode='delegated' requires delegated_secret_key_b58 + delegated_pubkey",
            );
          }
          const encKey = getEncryptionKey(deps.config);
          await updateConnectionSigning(deps.db, id, {
            signingMode: 'delegated',
            capPerTx: body.cap_per_tx,
            capPerDay: body.cap_per_day,
            encryptedDelegatedKey: encryptSecret(body.delegated_secret_key_b58, encKey),
            delegatedPubkey: body.delegated_pubkey,
          });
        } else {
          // Switching back to deep_link: clear caps + delegated key.
          await updateConnectionSigning(deps.db, id, {
            signingMode: 'deep_link',
            capPerTx: null,
            capPerDay: null,
            encryptedDelegatedKey: null,
            delegatedPubkey: null,
          });
        }
      }
      const after = await getExternalConnection(deps.db, id);
      if (!after) throw notFound('connection not found');
      return c.json(connectionToWire(after, deps.config), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/external/connections/{id}/refresh',
      tags: ['external'],
      summary: 'Regenerate verification_token (re-issue the deep link / QR)',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({
                connection: ConnectionPublicSchema,
                deep_link: z.string().nullable(),
                webhook_url: z.string().nullable(),
                telegram_webhook_registered: z.boolean().optional(),
                telegram_webhook_error: z.string().nullable().optional(),
              }),
            },
          },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const existing = await getExternalConnection(deps.db, id);
      if (!existing) throw notFound('connection not found');
      const token = newVerificationToken();
      await refreshVerificationToken(deps.db, { id, verificationToken: token });
      const after = await getExternalConnection(deps.db, id);
      if (!after) throw notFound('connection not found');
      const deepLink =
        after.channel === 'telegram' && after.botUsername
          ? `https://t.me/${after.botUsername}?start=${token}`
          : null;
      const webhookUrl =
        after.channel === 'telegram' && after.routingId
          ? webhookUrlForRouting(deps.config, after.routingId)
          : null;

      let telegramWebhookRegistered: boolean | undefined;
      let telegramWebhookError: string | null | undefined;
      if (after.channel === 'telegram' && webhookUrl && after.encryptedCredential) {
        try {
          const encKey = getEncryptionKey(deps.config);
          const botTok = decryptSecret(after.encryptedCredential, encKey);
          const reg = await registerTelegramWebhook(botTok, webhookUrl);
          telegramWebhookRegistered = reg.ok;
          telegramWebhookError = reg.ok ? null : reg.description;
        } catch {
          telegramWebhookRegistered = false;
          telegramWebhookError = 'Could not decrypt credential to register webhook.';
        }
      }

      return c.json(
        {
          connection: connectionToWire(after, deps.config),
          deep_link: deepLink,
          webhook_url: webhookUrl,
          ...(after.channel === 'telegram'
            ? {
                telegram_webhook_registered: telegramWebhookRegistered,
                telegram_webhook_error: telegramWebhookError ?? null,
              }
            : {}),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/external/connections/{id}',
      tags: ['external'],
      summary: 'Permanently delete a connection (cascades to messages, approvals, WA state)',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const existing = await getExternalConnection(deps.db, id);
      if (!existing) throw notFound('connection not found');
      // Tear down the live Baileys socket BEFORE deleting the row so
      // the manager doesn't try to write back creds/keys against a
      // missing connection_id mid-shutdown. `logout: true` unlinks the
      // device from the user's WhatsApp app — without this they'd
      // accumulate stale "Leash Agents" sessions in their linked-devices
      // list every time they delete + re-add. Telegram has no socket,
      // so this is a no-op for that channel.
      if (existing.channel === 'whatsapp' && deps.whatsapp) {
        await deps.whatsapp.stop(id, { logout: true }).catch(() => {});
      }
      // Best-effort: also clear the Telegram webhook so the user's bot
      // stops hitting our /webhook endpoint after the row is gone.
      // Failures are swallowed because BotFather may have already
      // rotated the token, the bot may be deleted, or Telegram's API
      // may be unreachable — none of which should block the delete.
      if (existing.channel === 'telegram' && existing.encryptedCredential) {
        try {
          const encKey = getEncryptionKey(deps.config);
          const { decryptSecret } = await import('@leash/platform-auth/encryption');
          const token = decryptSecret(existing.encryptedCredential, encKey);
          await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`).catch(() => {});
        } catch {
          /* ignore */
        }
      }
      await deleteExternalConnection(deps.db, id);
      return c.json({ ok: true as const }, 200);
    },
  );

  // ── whatsapp (admin-gated start + qr poll) ─────────────────────────
  // These two routes are the WhatsApp equivalent of the Telegram
  // `/start <token>` flow: the BFF calls `start` once when the user
  // clicks "Add WhatsApp", then polls `qr` until either the QR clears
  // (= paired) or the connection's `status` flips to `connected`.

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/external/whatsapp/start/{id}',
      tags: ['external'],
      summary: 'Start (or resume) a Baileys session for a WhatsApp connection',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({
                status: z.enum(['pairing', 'connecting', 'connected', 'error']),
                reason: z.string().optional(),
              }),
            },
          },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
        409: {
          description: 'wrong channel',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        503: {
          description: 'not enabled',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      if (!deps.whatsapp) {
        throw unavailable(
          'WhatsApp bridge is not enabled on this replica. Set LEASH_WHATSAPP_ENABLED=1 on the designated host.',
        );
      }
      const { id } = c.req.valid('param');
      const conn = await getExternalConnection(deps.db, id);
      if (!conn) throw notFound('connection not found');
      if (conn.channel !== 'whatsapp') {
        throw conflict('connection is not whatsapp');
      }
      const result = await deps.whatsapp.start(id);
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/external/whatsapp/qr/{id}',
      tags: ['external'],
      summary: 'Read the most recent pairing QR for the polling UI',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({
                qr: z.string().nullable(),
                qr_at: z.string().nullable(),
                status: StatusSchema,
                me_jid: z.string().nullable(),
              }),
            },
          },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const conn = await getExternalConnection(deps.db, id);
      if (!conn) throw notFound('connection not found');
      const row = await getWhatsAppState(deps.db, id);
      return c.json(
        {
          qr: row?.lastQr ?? null,
          qr_at: row?.lastQrAt ?? null,
          status: conn.status,
          me_jid: row?.meJid ?? null,
        },
        200,
      );
    },
  );

  // ── approvals (admin-gated create + consume) ────────────────────────

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/external/approvals',
      tags: ['external'],
      summary: 'Mint a one-time approval token for a chat-initiated signing tool',
      security: [{ AdminSecret: [] }],
      request: {
        body: { required: true, content: { 'application/json': { schema: CreateApprovalBody } } },
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({
                approval: ApprovalPublicSchema,
                approve_url: z.string(),
              }),
            },
          },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const conn = await getExternalConnection(deps.db, body.connection_id);
      if (!conn) throw notFound('connection not found');
      const approval = await createApproval(deps.db, {
        connectionId: body.connection_id,
        ownerPrivyId: conn.ownerPrivyId,
        agentMint: body.agent_mint,
        toolName: body.tool_name,
        payload: body.payload,
        ...(body.ttl_ms !== undefined ? { ttlMs: body.ttl_ms } : {}),
      });
      return c.json(
        {
          approval: approvalToWire(approval),
          approve_url: `${deps.config.agentsPublicOrigin}/approve/${approval.token}`,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/external/approvals/{token}/consume',
      tags: ['external'],
      summary: 'Mark an approval consumed (called from the deep-link page)',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ token: z.string().min(1) }),
        body: { required: true, content: { 'application/json': { schema: ConsumeApprovalBody } } },
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({
                approval: ApprovalPublicSchema,
                consumed: z.boolean(),
              }),
            },
          },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
        409: {
          description: 'already consumed or expired',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { token } = c.req.valid('param');
      const body = c.req.valid('json');
      const existing = await getApproval(deps.db, token);
      if (!existing) throw notFound('approval not found');
      const consumed = await consumeApproval(deps.db, {
        token,
        result:
          body.error != null
            ? { kind: 'error' as const, message: body.error }
            : {
                kind: 'ok' as const,
                receiptHash: body.receipt_hash ?? null,
                txSig: body.tx_sig ?? null,
              },
      });
      const after = await getApproval(deps.db, token);
      if (!after) throw notFound('approval not found');
      await notifyApprovalSettled(
        {
          config: deps.config,
          db: deps.db,
          cache: deps.cache,
          ...(deps.whatsapp ? { whatsapp: deps.whatsapp } : {}),
          ...(deps.dispatcherTelegramClientFactory
            ? { telegramClientFactory: deps.dispatcherTelegramClientFactory }
            : {}),
        },
        { approval: after, newlyConsumed: consumed },
      ).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[external] approval_settle_notify failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      return c.json({ approval: approvalToWire(after), consumed }, 200);
    },
  );

  return app;
}

/**
 * Public (no admin auth) sub-app: approval read + Telegram webhook.
 * Mounted separately so the admin middleware doesn't shadow them.
 */
export function buildExternalPublicRoutes(deps: ExternalRoutesDeps): OpenAPIHono {
  const app = new OpenAPIHono();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/external/approvals/{token}',
      tags: ['external'],
      summary: 'Read a pending approval (called by the deep-link landing page)',
      request: { params: z.object({ token: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: ApprovalPublicSchema } },
        },
        404: { description: 'nf', content: { 'application/json': { schema: ApiErrorSchema } } },
      },
    }),
    async (c) => {
      const { token } = c.req.valid('param');
      const row = await getApproval(deps.db, token);
      if (!row) throw notFound('approval not found');
      return c.json(approvalToWire(row), 200);
    },
  );

  // Telegram → us. We always return 200, even on bad requests, because
  // Telegram retries non-2xx with exponential backoff and we'd rather
  // drop a malformed update than spam our metrics with retries.
  //
  // Phase 1 scope:
  //   - Look up the connection by `routing_id`.
  //   - Match `update.message.from.id` against `bound_chat_id` (and the
  //     allowlist). Drop everything else.
  //   - Handle `/start <verification_token>` to bind the connection.
  //   - Record an audit row.
  //
  // The actual "run agent + reply" logic lives in phase 3 once
  // @leash/agent-runtime is extracted.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/external/telegram/webhook/{routing_id}',
      tags: ['external'],
      summary: 'Telegram webhook (phase 1: binding + audit only)',
      request: {
        params: z.object({ routing_id: z.string().min(1).max(128) }),
        body: { required: false, content: { 'application/json': { schema: z.unknown() } } },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: z.unknown() } } },
      },
    }),
    async (c) => {
      const { routing_id } = c.req.valid('param');
      const update = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const conn = await getConnectionByRoutingId(deps.db, 'telegram', routing_id);
      if (!conn) {
        return c.json({ ok: true, dropped: 'unknown_routing_id' }, 200);
      }
      const message = (update.message ?? update.edited_message) as
        | Record<string, unknown>
        | undefined;
      if (!message) {
        return c.json({ ok: true, dropped: 'no_message' }, 200);
      }
      const from = message.from as { id?: number | string } | undefined;
      const fromId = from?.id != null ? String(from.id) : null;
      const text = typeof message.text === 'string' ? message.text : '';

      // Try `/start <token>` binding first — this is the only path that
      // accepts a from-id we don't already know about. Telegram private
      // chats often send `/start@BotName payload` (deep link), not only
      // `/start payload`.
      const startMatch = /^\/start(?:@[A-Za-z0-9_]+)?\s+([\w-]+)/i.exec(text.trim());
      if (startMatch && fromId) {
        const token = startMatch[1];
        const pending = token ? await getConnectionByVerificationToken(deps.db, token) : null;
        if (pending && pending.id === conn.id && pending.status === 'pending') {
          const bound = await bindExternalConnection(deps.db, {
            id: pending.id,
            boundChatId: fromId,
          });
          if (bound) {
            await recordExternalMessage(deps.db, {
              connectionId: pending.id,
              direction: 'inbound',
              payload: { kind: 'bind', from_id: fromId },
            });
            sendTelegramPlainBestEffort(
              deps.config,
              pending,
              fromId,
              TELEGRAM_MSG_WELCOME_CONNECTED,
            );
            return c.json({ ok: true, bound: true }, 200);
          }
        }
        return c.json({ ok: true, bound: false }, 200);
      }

      // Bare `/start` or `/start@BotName` with no payload — Telegram clients
      // strip the deep-link payload in many flows (e.g. desktop "Open" button,
      // re-entering the chat). For a *pending* connection that has no
      // bound chat yet, the only plausible sender is the legitimate owner
      // who got the bot username from inside their authenticated Leash
      // session — auto-bind on first contact rather than trapping them.
      const bareStart = /^\/start(?:@[A-Za-z0-9_]+)?\s*$/i.test(text.trim());
      if (bareStart && fromId) {
        if (conn.status === 'pending' && !conn.boundChatId) {
          const bound = await bindExternalConnection(deps.db, {
            id: conn.id,
            boundChatId: fromId,
          });
          if (bound) {
            await recordExternalMessage(deps.db, {
              connectionId: conn.id,
              direction: 'inbound',
              payload: { kind: 'bind', from_id: fromId, via: 'bare_start' },
            });
            sendTelegramPlainBestEffort(deps.config, conn, fromId, TELEGRAM_MSG_WELCOME_CONNECTED);
            return c.json({ ok: true, bound: true, via: 'bare_start' }, 200);
          }
        }
        if (
          conn.status === 'connected' &&
          (fromId === conn.boundChatId || conn.allowlist.includes(fromId))
        ) {
          sendTelegramPlainBestEffort(deps.config, conn, fromId, TELEGRAM_MSG_WELCOME_BACK);
          return c.json({ ok: true, bare_start: 'welcome_back' }, 200);
        }
      }

      // From here on, only the bound chat-id (or allowlisted ids) are
      // permitted to drive the agent. Anyone else is silently ignored.
      const allowed =
        fromId != null && (fromId === conn.boundChatId || conn.allowlist.includes(fromId));
      if (!allowed) {
        return c.json({ ok: true, dropped: 'unauthorized_sender' }, 200);
      }

      await recordExternalMessage(deps.db, {
        connectionId: conn.id,
        direction: 'inbound',
        payload: {
          from_id: fromId,
          // We intentionally don't store the body itself — only its
          // length so audit rows stay PII-light. The dispatcher's
          // outbound row carries the hash + length pair.
          text_len: text.length,
        },
      });

      // Fire-and-forget: run the agent + reply asynchronously so
      // Telegram gets its 200 inside its 60s window even when the LLM
      // takes longer. Errors inside the dispatcher are swallowed —
      // Telegram only retries non-2xx responses, and we'd rather drop a
      // turn than re-process the same update twice.
      const dispatcherDeps: DispatcherDeps = {
        config: deps.config,
        db: deps.db,
        cache: deps.cache,
        ...(deps.dispatcherBffFetch ? { bffFetch: deps.dispatcherBffFetch } : {}),
        ...(deps.dispatcherTelegramClientFactory
          ? { telegramClientFactory: deps.dispatcherTelegramClientFactory }
          : {}),
      };
      const runPromise = dispatchTelegramMessage(dispatcherDeps, {
        connection: conn,
        message: text,
        fromId: fromId ?? '',
      }).catch(() => {
        // best-effort dispatch; surfacing errors here would force
        // Telegram to retry the same update. Silent drop is preferred.
      });
      // In tests we await the dispatcher so assertions can observe
      // outbound side-effects (sendMessage call, approvals row). In
      // production we let it run after the 200 returns.
      if (process.env.LEASH_API_AWAIT_DISPATCH === '1') {
        await runPromise;
      }
      return c.json({ ok: true, queued: true }, 200);
    },
  );

  return app;
}
