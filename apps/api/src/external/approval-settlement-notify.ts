/**
 * When a browser `/approve/{token}` flow POSTs consume, we mark the row
 * in `external_approvals` — this module turns that into a real chat
 * message on Telegram/WhatsApp plus an assistant line in the external
 * transcript so the next agent turn has continuity.
 */
import { decryptSecret } from '@leashmarket/platform-auth/encryption';
import { leashReceiptUrl } from '@leashmarket/core';

import type { LeashApiConfig } from '../config.js';
import {
  getExternalConnection,
  recordExternalMessage,
  type ExternalApprovalRow,
} from '../storage/external-connections.js';
import type { CacheClient } from '../storage/redis.js';
import type { DbClient } from '../storage/turso.js';
import { appendExternalAssistantLine } from './external-channel-context.js';
import { createTelegramClient, type TelegramClient } from './telegram-client.js';
import type { WhatsAppManager } from './whatsapp-manager.js';

export type ApprovalNotifyDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
  whatsapp?: WhatsAppManager;
  telegramClientFactory?: (botToken: string) => TelegramClient;
};

/** Minimal HTML escapes for Telegram `parse_mode: HTML` bodies. */
function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type SettlementNotificationCopy =
  | {
      kind: 'success';
      /** WhatsApp: `*…*` bold */
      whatsappText: string;
      /** Telegram: `<b>…</b>` */
      telegramHtml: string;
      /** No markup — external transcript + model context */
      transcriptPlain: string;
    }
  | { kind: 'error'; textPlain: string };

export function buildApprovalSettlementNotification(args: {
  approval: ExternalApprovalRow;
  explorerOrigin: string;
}): SettlementNotificationCopy {
  const { approval, explorerOrigin } = args;
  const base = explorerOrigin.replace(/\/+$/, '');
  if (approval.resultError) {
    return {
      kind: 'error',
      textPlain: `\u2139\ufe0f Approval closed.\n\nReason: ${approval.resultError}`,
    };
  }
  const receiptHref = leashReceiptUrl(approval.resultReceiptHash, { baseUrl: base });
  const receiptLine = receiptHref
    ? `Receipt: ${receiptHref}`
    : 'Receipt: (unavailable — no receipt hash was recorded)';
  const transcriptPlain = `Payment completed\n\n${receiptLine}`;
  const whatsappText = `*Payment completed*\n\n${receiptLine}`;
  const telegramHtml = `<b>Payment completed</b>\n\n${escapeTelegramHtml(receiptLine)}`;
  return { kind: 'success', whatsappText, telegramHtml, transcriptPlain };
}

export async function notifyApprovalSettled(
  deps: ApprovalNotifyDeps,
  args: { approval: ExternalApprovalRow; newlyConsumed: boolean },
): Promise<void> {
  if (!args.newlyConsumed) return;

  const conn = await getExternalConnection(deps.db, args.approval.connectionId);
  if (!conn || conn.status !== 'connected') return;

  const copy = buildApprovalSettlementNotification({
    approval: args.approval,
    explorerOrigin: deps.config.explorerPublicOrigin,
  });
  const transcriptPlain = copy.kind === 'success' ? copy.transcriptPlain : copy.textPlain;

  try {
    if (conn.channel === 'whatsapp' && deps.whatsapp) {
      const outgoing = copy.kind === 'success' ? copy.whatsappText : copy.textPlain;
      await deps.whatsapp.sendOutboundText(conn.id, outgoing);
    } else if (conn.channel === 'telegram') {
      if (!conn.encryptedCredential || !deps.config.encryptionKey) return;
      let botToken: string;
      try {
        botToken = decryptSecret(conn.encryptedCredential, deps.config.encryptionKey);
      } catch {
        return;
      }
      const telegram = deps.telegramClientFactory?.(botToken) ?? createTelegramClient({ botToken });
      const chatId = conn.boundChatId;
      if (!chatId) return;
      if (copy.kind === 'success') {
        await telegram.sendMessage({
          chatId,
          text: copy.telegramHtml,
          parseMode: 'HTML',
          disableWebPagePreview: false,
        });
      } else {
        await telegram.sendMessage({
          chatId,
          text: copy.textPlain,
          disableWebPagePreview: false,
        });
      }
    }
  } catch {
    /* best-effort chat notify */
  }

  await recordExternalMessage(deps.db, {
    connectionId: conn.id,
    direction: 'outbound',
    payload: {
      kind: 'approval_settled',
      token: args.approval.token,
      len: transcriptPlain.length,
    },
  });

  await appendExternalAssistantLine(deps.cache, conn.id, transcriptPlain).catch(() => {});
}
