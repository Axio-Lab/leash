/**
 * WhatsApp dispatcher.
 *
 * Identical pipeline to the Telegram dispatcher (run agent → mint
 * approvals → send reply), but the send step uses an active Baileys
 * `WASocket` rather than an HTTP call. The socket is provided by the
 * caller (`whatsapp-manager.ts`) — we never import Baileys here so
 * apps/api can compile without it loaded.
 *
 * Channel-native formatting is much simpler than Telegram's: WhatsApp
 * silently strips unrecognised markdown so we just render the plain
 * markdown with light normalisations (`**bold**` → `*bold*`,
 * `[label](url)` → `label (url)`).
 */

import type { LeashApiConfig } from '../config.js';
import {
  recordExternalMessage,
  type ExternalConnectionRow,
} from '../storage/external-connections.js';
import type { DbClient } from '../storage/turso.js';
import { formatArtifactForWhatsApp, toWhatsApp } from './formatter.js';
import { runAgentForExternalChannel } from './dispatcher-shared.js';

/**
 * Minimal interface around the parts of `WASocket` we use. Keeping
 * this as a structural type means `whatsapp-manager.ts` can pass the
 * Baileys socket directly without us depending on the Baileys types.
 */
export type WhatsAppSendable = {
  sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
};

export type WhatsAppDispatcherDeps = {
  config: LeashApiConfig;
  db: DbClient;
  /**
   * The active Baileys socket for this connection. The manager
   * passes `socket as WhatsAppSendable` — we only need
   * `socket.sendMessage(jid, {text})`.
   */
  socket: WhatsAppSendable;
  bffFetch?: typeof fetch;
};

export async function dispatchWhatsAppMessage(
  deps: WhatsAppDispatcherDeps,
  args: { connection: ExternalConnectionRow; message: string; fromId: string },
): Promise<{ ok: boolean; reason?: string; replied?: boolean }> {
  const { config, db, socket } = deps;
  const conn = args.connection;
  const replyJid = jidForPhone(conn.boundChatId ?? args.fromId);

  const shared = await runAgentForExternalChannel(
    { config, db, ...(deps.bffFetch ? { bffFetch: deps.bffFetch } : {}) },
    { connection: conn, message: args.message },
  );
  if (!shared.ok) {
    await safeSend(socket, replyJid, shared.userFacingError);
    return { ok: false, reason: shared.reason, replied: true };
  }

  const sections: string[] = [];
  if (shared.bffResult.text && shared.bffResult.text.length > 0) {
    sections.push(toWhatsApp(shared.bffResult.text));
  }
  for (const s of shared.summaries) {
    sections.push(formatArtifactForWhatsApp(s));
  }
  if (shared.bffResult.errors && shared.bffResult.errors.length > 0) {
    const joined = shared.bffResult.errors.slice(0, 2).join('; ');
    sections.push(`\u26a0\ufe0f ${joined}`);
  }
  const body = sections.join('\n\n');
  const final = body.length > 0 ? body : '(empty reply — try rephrasing)';

  await safeSend(socket, replyJid, final);

  await recordExternalMessage(db, {
    connectionId: conn.id,
    direction: 'outbound',
    payload: {
      kind: 'reply',
      artifacts: shared.summaries.length,
      length: final.length,
      channel: 'whatsapp',
    },
  });

  return { ok: true, replied: true };
}

async function safeSend(socket: WhatsAppSendable, jid: string, text: string): Promise<void> {
  try {
    await socket.sendMessage(jid, { text });
  } catch {
    // WhatsApp socket errors aren't actionable from here — Baileys
    // will reconnect on its own and the next inbound message will
    // re-trigger the dispatcher.
  }
}

/**
 * Normalise a phone number / partial JID into the full
 * `<phone>@s.whatsapp.net` JID Baileys expects on `sendMessage`.
 * Already-fully-qualified JIDs pass through unchanged.
 */
function jidForPhone(value: string): string {
  if (value.includes('@')) return value;
  // Strip leading + and non-digit chars; Baileys wants the raw
  // E.164-style number without punctuation.
  const digits = value.replace(/[^\d]/g, '');
  return `${digits}@s.whatsapp.net`;
}
