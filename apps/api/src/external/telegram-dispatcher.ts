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
 * Steps 1+2 live in `dispatcher-shared.ts` so WhatsApp can reuse them
 * verbatim. This file is now Telegram-specific glue (decrypt token,
 * format MarkdownV2, sendMessage with parse-mode fallback).
 */

import { decryptSecret } from '@leash/platform-auth/encryption';

import type { LeashApiConfig } from '../config.js';
import {
  recordExternalMessage,
  type ExternalConnectionRow,
} from '../storage/external-connections.js';
import type { DbClient } from '../storage/turso.js';
import {
  formatArtifactForTelegram,
  toTelegramMarkdownV2,
  type ArtifactSummary,
} from './formatter.js';
import { runAgentForExternalChannel } from './dispatcher-shared.js';
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

// Re-exported so existing callers (the `external.ts` route file)
// don't need to reach into the shared module directly.
export type { AgentBffResponse } from './dispatcher-shared.js';

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

  const telegram = deps.telegramClientFactory?.(botToken) ?? createTelegramClient({ botToken });
  const replyChatId = conn.boundChatId ?? args.fromId;

  const shared = await runAgentForExternalChannel(
    { config, db, ...(deps.bffFetch ? { bffFetch: deps.bffFetch } : {}) },
    { connection: conn, message: args.message },
  );
  if (!shared.ok) {
    await safeReply(telegram, replyChatId, shared.userFacingError, false);
    return { ok: false, reason: shared.reason, replied: true };
  }

  // Compose the message body. Assistant text first, then one
  // formatted block per artifact, then warnings/errors.
  const sections: string[] = [];
  if (shared.bffResult.text && shared.bffResult.text.length > 0) {
    sections.push(toTelegramMarkdownV2(shared.bffResult.text));
  }
  for (const s of shared.summaries) {
    sections.push(formatArtifactForTelegram(s));
  }
  if (shared.bffResult.errors && shared.bffResult.errors.length > 0) {
    const joined = shared.bffResult.errors.slice(0, 2).join('; ');
    sections.push(`\u26a0\ufe0f ${toTelegramMarkdownV2(joined)}`);
  }

  const body = sections.join('\n\n');
  const final = body.length > 0 ? body : '\\(empty reply — try rephrasing\\)';

  const reply = await telegram.sendMessage({
    chatId: replyChatId,
    text: final,
    parseMode: 'MarkdownV2',
    disableWebPagePreview: false,
  });
  if (!reply.ok) {
    // MarkdownV2 parse errors are the most common — fall back to plain.
    await safeReply(telegram, replyChatId, stripMarkdownV2Escapes(final), false);
  }

  await recordExternalMessage(db, {
    connectionId: conn.id,
    direction: 'outbound',
    payload: {
      kind: 'reply',
      artifacts: shared.summaries.length,
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
 * single-character escapes so the user sees readable plain text.
 */
function stripMarkdownV2Escapes(text: string): string {
  return text.replace(/\\([_*[\]()~>#+\-=|{}.!\\])/g, '$1');
}

export type { ArtifactSummary };
