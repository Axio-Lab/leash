/**
 * Telegram dispatcher.
 *
 * Glues four pieces together:
 *   1. apps/agents BFF (`POST /api/agents/run`) — runs the same agent
 *      loop the in-app chat uses, returns `{text, artifacts}`.
 *   2. apps/api `/v1/external/approvals` — mints a one-time deep-link
 *      token per signing artifact when the connection is in
 *      `deep_link` mode (Pattern A) or when the artifact is in the
 *      `ALWAYS_DEEP_LINK_KINDS` set (withdrawals, etc).
 *   3. The channel-native formatter — converts the agent's free-form
 *      markdown into MarkdownV2 + appends artifact summaries.
 *   4. The Telegram Bot API — sends the formatted reply back to the
 *      user's chat.
 *
 * Failure modes are intentionally lossy: every step that could throw
 * (BFF unreachable, Telegram 5xx, MarkdownV2 parse error) falls back to
 * a plain-text reply rather than dropping the turn entirely. The
 * webhook handler always returns 200 to Telegram so it doesn't retry
 * and dispatch the same update twice.
 */

import { decryptSecret } from '@leash/platform-auth/encryption';

import type { LeashApiConfig } from '../config.js';
import {
  createApproval,
  recordExternalMessage,
  touchConnectionLastSeen,
  type ExternalConnectionRow,
} from '../storage/external-connections.js';
import type { DbClient } from '../storage/turso.js';
import {
  ALWAYS_DEEP_LINK_KINDS,
  formatArtifactForTelegram,
  toTelegramMarkdownV2,
  type ArtifactSummary,
} from './formatter.js';
import { createTelegramClient, type TelegramClient } from './telegram-client.js';

export type DispatcherDeps = {
  config: LeashApiConfig;
  db: DbClient;
  /**
   * Override for tests — both fields default to `globalThis.fetch`.
   * The dispatcher never imports `node:fetch` directly so injecting a
   * stub from a test rig is enough to hermetically test the full flow.
   */
  bffFetch?: typeof fetch;
  telegramClientFactory?: (botToken: string) => TelegramClient;
};

export type AgentBffResponse = {
  text: string;
  artifacts: Array<{ kind: ArtifactSummary['kind']; payload: Record<string, unknown> }>;
  errors?: string[];
  warnings?: string[];
  agent_mint?: string | null;
  model?: string;
};

/**
 * Run an external-channel turn end-to-end:
 *   - record the inbound message,
 *   - call apps/agents BFF for the LLM reply + artifacts,
 *   - mint approval tokens for each signing artifact (Pattern A or
 *     fallback for the always-deep-link kinds in Pattern C),
 *   - send the formatted reply back through Telegram.
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, reason }` for
 * caller diagnostics. The caller (webhook handler) ignores the result
 * and always replies 200 to Telegram.
 */
export async function dispatchTelegramMessage(
  deps: DispatcherDeps,
  args: {
    connection: ExternalConnectionRow;
    message: string;
    fromId: string;
  },
): Promise<{ ok: boolean; reason?: string; replied?: boolean }> {
  const { config, db } = deps;
  const conn = args.connection;

  if (!config.agentsBffUrl || !config.agentsBffSecret) {
    return { ok: false, reason: 'agents_bff_not_configured' };
  }
  if (!conn.encryptedCredential) {
    return { ok: false, reason: 'connection_missing_credential' };
  }
  if (!config.encryptionKey) {
    return { ok: false, reason: 'encryption_key_not_configured' };
  }

  let botToken: string;
  try {
    botToken = decryptSecret(conn.encryptedCredential, config.encryptionKey);
  } catch (err) {
    return {
      ok: false,
      reason: `decrypt_credential_failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }

  const fetchImpl = deps.bffFetch ?? globalThis.fetch;
  const telegram = deps.telegramClientFactory?.(botToken) ?? createTelegramClient({ botToken });

  await touchConnectionLastSeen(db, conn.id).catch(() => {});

  // 1) Run the agent on apps/agents.
  let bffResult: AgentBffResponse;
  try {
    const res = await fetchImpl(`${config.agentsBffUrl}/api/agents/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.agentsBffSecret}`,
      },
      body: JSON.stringify({
        owner_privy_id: conn.ownerPrivyId,
        channel: conn.channel,
        message: args.message,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      await safeReply(
        telegram,
        conn.boundChatId ?? args.fromId,
        `\u26a0\ufe0f Couldn\u2019t reach the agent runtime (HTTP ${res.status}). Try again in a moment.`,
        false,
      );
      return { ok: false, reason: `bff_${res.status}`, replied: true };
    }
    bffResult = JSON.parse(text) as AgentBffResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await safeReply(
      telegram,
      conn.boundChatId ?? args.fromId,
      `\u26a0\ufe0f Couldn\u2019t reach the agent runtime: ${message}. Try again in a moment.`,
      false,
    );
    return { ok: false, reason: `bff_unreachable: ${message}`, replied: true };
  }

  // 2) Mint approval tokens for every artifact that needs human-in-the-loop
  //    signing. Read tools (no artifact emitted) skip this branch.
  const summaries: ArtifactSummary[] = [];
  for (const a of bffResult.artifacts) {
    const shouldDeepLink = needsDeepLink(a.kind, conn);
    let approveUrl: string | null = null;
    if (shouldDeepLink && bffResult.agent_mint) {
      try {
        const approval = await createApproval(db, {
          connectionId: conn.id,
          ownerPrivyId: conn.ownerPrivyId,
          agentMint: bffResult.agent_mint,
          toolName: artifactKindToToolName(a.kind),
          payload: a.payload,
        });
        approveUrl = `${config.publicOrigin}/approve/${approval.token}`;
        await recordExternalMessage(db, {
          connectionId: conn.id,
          direction: 'approval',
          payload: { token: approval.token, kind: a.kind },
        });
      } catch {
        // Approval mint shouldn't kill the reply — degrade to no link.
        approveUrl = null;
      }
    }
    summaries.push({ kind: a.kind, payload: a.payload, approveUrl });
  }

  // 3) Compose the message body. Assistant text first, then one
  //    formatted block per artifact, then warnings/errors.
  const sections: string[] = [];
  if (bffResult.text && bffResult.text.length > 0) {
    sections.push(toTelegramMarkdownV2(bffResult.text));
  }
  for (const s of summaries) {
    sections.push(formatArtifactForTelegram(s));
  }
  if (bffResult.errors && bffResult.errors.length > 0) {
    const joined = bffResult.errors.slice(0, 2).join('; ');
    sections.push(`\u26a0\ufe0f ${toTelegramMarkdownV2(joined)}`);
  }

  const body = sections.join('\n\n');
  const final = body.length > 0 ? body : '\\(empty reply — try rephrasing\\)';

  const reply = await telegram.sendMessage({
    chatId: conn.boundChatId ?? args.fromId,
    text: final,
    parseMode: 'MarkdownV2',
    disableWebPagePreview: false,
  });
  if (!reply.ok) {
    // MarkdownV2 parse errors are the most common — fall back to plain.
    await safeReply(
      telegram,
      conn.boundChatId ?? args.fromId,
      stripMarkdownV2Escapes(final),
      false,
    );
  }

  await recordExternalMessage(db, {
    connectionId: conn.id,
    direction: 'outbound',
    payload: {
      kind: 'reply',
      artifacts: summaries.length,
      length: final.length,
    },
  });

  return { ok: true, replied: true };
}

async function safeReply(
  telegram: TelegramClient,
  chatId: string,
  text: string,
  asMarkdown: boolean,
): Promise<void> {
  try {
    await telegram.sendMessage({
      chatId,
      text,
      ...(asMarkdown ? { parseMode: 'MarkdownV2' as const } : {}),
    });
  } catch {
    // last-resort no-op — Telegram unreachable.
  }
}

/**
 * Reverse of `escapeTelegramText` for our limited fallback path: when
 * MarkdownV2 parsing fails we strip the leading backslashes off
 * single-character escapes so the user sees readable plain text. This
 * is a best-effort fallback and intentionally not exact (e.g. `\\\\` →
 * `\` is left as-is).
 */
function stripMarkdownV2Escapes(text: string): string {
  return text.replace(/\\([_*[\]()~>#+\-=|{}.!\\])/g, '$1');
}

function needsDeepLink(kind: ArtifactSummary['kind'], conn: ExternalConnectionRow): boolean {
  if (ALWAYS_DEEP_LINK_KINDS.has(kind)) return true;
  if (conn.signingMode === 'deep_link') return true;
  // Pattern C: signing-mode='delegated' would let us sign inline up to
  // caps. Inline signing isn't implemented yet — phase 5/follow-up — so
  // we degrade gracefully to deep-link until that lands. The caps in
  // the row are still meaningful: the future inline-signer will read
  // them when deciding whether to sign or escalate.
  return true;
}

function artifactKindToToolName(kind: ArtifactSummary['kind']): string {
  switch (kind) {
    case 'payment_request':
      return 'leash_pay_payment_link';
    case 'withdraw_request':
      return 'leash_withdraw_treasury';
    case 'payment_link':
      return 'leash_create_payment_link';
    case 'receipt':
      return 'leash_get_receipt';
    case 'tool_call':
    default:
      return 'tool_call';
  }
}
