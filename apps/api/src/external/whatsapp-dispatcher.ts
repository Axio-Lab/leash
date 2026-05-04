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
import {
  formatArtifactForWhatsApp,
  stripEchoedPaymentRequestCardFromAssistantText,
  toWhatsApp,
} from './formatter.js';
import { runAgentForExternalChannel } from './dispatcher-shared.js';
import { registerWhatsAppOutboundStanza } from './whatsapp-outbound-echo.js';
import { waJidForPhone } from './whatsapp-jid.js';
import type { CacheClient } from '../storage/redis.js';

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
   * Rolling transcript for `POST /api/agents/run` so follow-up messages
   * are not isolated turns.
   */
  cache: CacheClient;
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
  args: { connection: ExternalConnectionRow; message: string; fromId: string; traceId: string },
): Promise<{ ok: boolean; reason?: string; replied?: boolean }> {
  const { config, db, cache, socket } = deps;
  const conn = args.connection;
  const replyJid = waJidForPhone(conn.boundChatId ?? args.fromId);
  const t = args.traceId;

  const shared = await runAgentForExternalChannel(
    { config, db, cache, ...(deps.bffFetch ? { bffFetch: deps.bffFetch } : {}) },
    { connection: conn, message: args.message, traceId: t },
  );
  if (!shared.ok) {
    await safeSend(socket, replyJid, shared.userFacingError, t, conn.id);
    return { ok: false, reason: shared.reason, replied: true };
  }

  const sections: string[] = [];
  const prose = stripEchoedPaymentRequestCardFromAssistantText(
    shared.bffResult.text ?? '',
    shared.summaries,
  );
  if (prose.length > 0) {
    sections.push(toWhatsApp(prose));
  }
  for (const s of shared.summaries) {
    const chunk = formatArtifactForWhatsApp(s);
    if (chunk.length > 0) sections.push(chunk);
  }
  if (shared.bffResult.errors && shared.bffResult.errors.length > 0) {
    const joined = shared.bffResult.errors.slice(0, 2).join('; ');
    sections.push(`\u26a0\ufe0f ${joined}`);
  }
  const body = sections.join('\n\n');
  const final = body.length > 0 ? body : '(empty reply — try rephrasing)';

  await safeSend(socket, replyJid, final, t, conn.id);

  await recordExternalMessage(db, {
    connectionId: conn.id,
    direction: 'outbound',
    payload: {
      kind: 'reply',
      artifacts: shared.summaries.length,
      length: final.length,
      channel: 'whatsapp',
      trace_id: t,
    },
  });

  return { ok: true, replied: true };
}

async function safeSend(
  socket: WhatsAppSendable,
  jid: string,
  text: string,
  traceId: string,
  connectionId: string,
): Promise<void> {
  try {
    const result = (await socket.sendMessage(waJidForPhone(jid), { text })) as
      | { key?: { id?: string } }
      | undefined;
    registerWhatsAppOutboundStanza(connectionId, result?.key?.id);
  } catch (err) {
    // WhatsApp socket errors aren't actionable from here — Baileys
    // will reconnect on its own and the next inbound message will
    // re-trigger the dispatcher. Log so we can see when sends fail.
    // eslint-disable-next-line no-console
    console.error(
      `[wa:pipe] trace=${traceId} send_failed jid=${jid} bytes=${text.length}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
