/**
 * In-process Baileys session manager.
 *
 * Owns one `WASocket` per connected `external_connections.id`, plus an
 * encrypted-DB-backed adapter for the Baileys `AuthenticationState`
 * interface. The manager is intentionally a singleton — Baileys
 * instances are heavy (signal protocol state) and WhatsApp Web only
 * permits one active session per device pairing anyway.
 *
 * Responsibilities:
 *   - `start(id)`     — open (or resume) a socket, surface QR codes,
 *                       persist creds/keys back to the DB.
 *   - `stop(id)`      — graceful logout (drops the device link); used
 *                       on connection revoke.
 *   - `dispose(id)`   — silent close without logout (used at process
 *                       shutdown / on transient errors so resume works
 *                       on next start).
 *   - `getQr(id)`     — read the most recent QR string for the polling UI.
 *   - inbound dispatch — routes `messages.upsert` to the same
 *     `dispatchExternalMessage` path Telegram uses, with the same
 *     enforcement (`from === bound_chat_id || self`) and the same
 *     deep-link approval mint.
 *
 * What the manager does NOT do:
 *   - Persistent retry across process restarts. The dispatcher
 *     re-opens connections on demand; if the API process crashes
 *     mid-session, the user re-opens the External tab and the manager
 *     resumes from the encrypted state. WhatsApp tolerates short
 *     reconnects without re-pairing as long as creds are intact.
 *   - Multi-replica coordination. Only one apps/api replica should be
 *     designated the "WhatsApp host" for now. We document this in
 *     ENABLE_WHATSAPP — operators set it on exactly one replica.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import {
  areJidsSameUser,
  Browsers,
  BufferJSON,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  isJidGroup,
  isJidStatusBroadcast,
  makeCacheableSignalKeyStore,
  makeWASocket,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type WASocket,
} from 'baileys';
import type { ILogger } from 'baileys/lib/Utils/logger.js';

import type { LeashApiConfig } from '../config.js';
import {
  bindExternalConnection,
  getExternalConnection,
  recordExternalMessage,
  touchConnectionLastSeen,
  updateConnectionStatus,
  type ExternalConnectionRow,
} from '../storage/external-connections.js';
import {
  ensureWhatsAppStateRow,
  getWhatsAppState,
  loadWhatsAppCreds,
  loadWhatsAppKeys,
  saveWhatsAppCreds,
  saveWhatsAppKeys,
  saveWhatsAppQr,
} from '../storage/external-whatsapp.js';
import type { DbClient } from '../storage/turso.js';
import {
  clearWhatsAppOutboundEcho,
  isWhatsAppOutboundEcho,
  registerWhatsAppOutboundStanza,
  resetWhatsAppOutboundEchoForTests,
} from './whatsapp-outbound-echo.js';
import { waJidForPhone } from './whatsapp-jid.js';

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

const noopLogger: Pick<ILogger, 'trace' | 'debug' | 'info' | 'warn' | 'error'> = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Baileys ships a Pino instance that prints one JSON line per internal event.
 * Override it so normal `pnpm dev` stays quiet; real failures still surface
 * via our `events.emit('error', …)` / `console.error` paths.
 */
const silentBaileysLogger: ILogger = {
  level: 'silent',
  child: () => silentBaileysLogger,
  ...noopLogger,
};

/**
 * Baileys often delivers the same stanza twice — e.g. `append` when you
 * send from the phone, then `notify` when the server echoes it. Without
 * dedupe we run the agent twice and the user gets duplicate replies.
 */
const INBOUND_STANZA_DEDUPE_TTL_MS = 15 * 60 * 1000;
const INBOUND_STANZA_DEDUPE_MAX = 2000;
const recentInboundStanzaIds = new Map<string, Map<string, number>>();

function isDuplicateInboundStanza(connectionId: string, stanzaId: string | undefined): boolean {
  if (!stanzaId || stanzaId === 'unknown') return false;
  const now = Date.now();
  let inner = recentInboundStanzaIds.get(connectionId);
  if (!inner) {
    inner = new Map();
    recentInboundStanzaIds.set(connectionId, inner);
  }
  const seenAt = inner.get(stanzaId);
  if (seenAt !== undefined && now - seenAt < INBOUND_STANZA_DEDUPE_TTL_MS) {
    return true;
  }
  inner.set(stanzaId, now);
  for (const [id, t] of inner) {
    if (now - t > INBOUND_STANZA_DEDUPE_TTL_MS) inner.delete(id);
  }
  if (inner.size > INBOUND_STANZA_DEDUPE_MAX) {
    const entries = [...inner.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < entries.length - 1000; i++) {
      inner.delete(entries[i][0]);
    }
  }
  return false;
}

/**
 * In-memory cache of `<type>-<id>` → key. Loaded from the encrypted DB
 * blob at session start, mutated on every Baileys `keys.set`, and
 * flushed back as one debounced encrypted write.
 *
 * Storing the keys map as one blob (vs. one row per key) trades write
 * amplification for simpler crypto + atomic recovery — Baileys batches
 * its writes, so the debounced flush already coalesces traffic.
 */
type KeyMap = Record<string, unknown>;

export type WhatsAppManagerDeps = {
  config: LeashApiConfig;
  db: DbClient;
  /**
   * Called when a message arrives for a connected session. The
   * caller wires this to `dispatchWhatsAppMessage` (passing the live
   * socket) so both channels share the run-agent + mint-approvals
   * pipeline.
   */
  onInboundMessage: (args: {
    connection: ExternalConnectionRow;
    message: string;
    fromId: string;
    /** Short correlation id — same value is forwarded to BFF logs (`x-leash-trace`). */
    traceId: string;
    socket: { sendMessage: (jid: string, content: { text: string }) => Promise<unknown> };
  }) => Promise<void>;
};

export type WhatsAppManager = {
  start(
    connectionId: string,
  ): Promise<{ status: 'pairing' | 'connected' | 'error'; reason?: string }>;
  stop(connectionId: string, opts?: { logout?: boolean }): Promise<void>;
  getStatus(connectionId: string): 'idle' | 'pairing' | 'connecting' | 'connected' | 'error';
  /** Per-process subscription for tests / health endpoints. */
  events: EventEmitter;
  /**
   * Push a plain-text DM to the bound self-chat when the user is not
   * typing (e.g. browser approval just settled). Returns `false` when
   * there is no live connected socket.
   */
  sendOutboundText(connectionId: string, text: string): Promise<boolean>;
};

export function createWhatsAppManager(deps: WhatsAppManagerDeps): WhatsAppManager {
  type Session = {
    id: string;
    socket: WASocket | null;
    state: 'idle' | 'pairing' | 'connecting' | 'connected' | 'error';
    creds: AuthenticationCreds;
    keys: KeyMap;
    keysSaveTimer: NodeJS.Timeout | null;
    keysDirty: boolean;
  };

  const sessions = new Map<string, Session>();
  const events = new EventEmitter();

  function getEncryptionKey(): string {
    const key = deps.config.encryptionKey;
    if (!key || key.length !== 64) {
      throw new Error('WhatsApp manager requires ENCRYPTION_KEY (64-hex-char AES-GCM key)');
    }
    return key;
  }

  function buildAuthState(session: Session): AuthenticationState {
    return {
      creds: session.creds,
      keys: makeCacheableSignalKeyStore({
        get: <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ): { [id: string]: SignalDataTypeMap[T] } => {
          const data: Record<string, SignalDataTypeMap[T]> = {};
          for (const id of ids) {
            const k = `${type}-${id}`;
            const value = session.keys[k];
            if (value !== undefined) {
              if (type === 'app-state-sync-key' && value) {
                data[id] = proto.Message.AppStateSyncKeyData.fromObject(
                  value as object,
                ) as unknown as SignalDataTypeMap[T];
              } else {
                data[id] = value as SignalDataTypeMap[T];
              }
            }
          }
          return data;
        },
        set: (data) => {
          for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
            const bucket = data[category];
            if (!bucket) continue;
            for (const id of Object.keys(bucket)) {
              const key = `${category}-${id}`;
              const v = bucket[id];
              if (v == null) {
                delete session.keys[key];
              } else {
                session.keys[key] = v;
              }
            }
          }
          session.keysDirty = true;
          scheduleKeysFlush(session);
        },
      }),
    };
  }

  function scheduleKeysFlush(session: Session): void {
    if (session.keysSaveTimer) return;
    session.keysSaveTimer = setTimeout(() => {
      session.keysSaveTimer = null;
      void flushKeys(session).catch((err) => {
        events.emit('error', { id: session.id, where: 'flushKeys', err });
      });
    }, 1000);
  }

  async function flushKeys(session: Session): Promise<void> {
    if (!session.keysDirty) return;
    session.keysDirty = false;
    const keysJson = JSON.stringify(session.keys, BufferJSON.replacer);
    await saveWhatsAppKeys(deps.db, {
      connectionId: session.id,
      keysJson,
      encryptionKey: getEncryptionKey(),
    });
  }

  async function flushCreds(session: Session): Promise<void> {
    const credsJson = JSON.stringify(session.creds, BufferJSON.replacer);
    await saveWhatsAppCreds(deps.db, {
      connectionId: session.id,
      credsJson,
      encryptionKey: getEncryptionKey(),
      meJid: session.creds.me?.id ?? null,
    });
  }

  async function loadOrInit(connectionId: string): Promise<{
    creds: AuthenticationCreds;
    keys: KeyMap;
  }> {
    await ensureWhatsAppStateRow(deps.db, connectionId);
    const row = await getWhatsAppState(deps.db, connectionId);
    const credsRaw = row ? loadWhatsAppCreds(row, getEncryptionKey()) : null;
    const keysRaw = row ? loadWhatsAppKeys(row, getEncryptionKey()) : null;
    const creds: AuthenticationCreds = credsRaw
      ? (JSON.parse(credsRaw, BufferJSON.reviver) as AuthenticationCreds)
      : initAuthCreds();
    const keys: KeyMap = keysRaw ? (JSON.parse(keysRaw, BufferJSON.reviver) as KeyMap) : {};
    return { creds, keys };
  }

  async function attachSocket(session: Session): Promise<WASocket> {
    // `fetchLatestBaileysVersion` hits a CDN every call (~1-3s round
    // trip). It returns the same version for every session in the
    // process lifetime, so we cache it. First call eats the latency,
    // subsequent ones are instant — which is the difference between
    // a 6s and a 3s "scan the QR" UX.
    const version = await getCachedBaileysVersion();
    const auth = buildAuthState(session);
    const socket = makeWASocket({
      version,
      auth,
      logger: silentBaileysLogger,
      printQRInTerminal: false,
      browser: Browsers.macOS('Leash Agents'),
      // We only need text-message handling — defer heavy contact /
      // chat history sync (Baileys default fetches everything on
      // first pair, which is wasteful for a one-to-one bot).
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    socket.ev.on('creds.update', () => {
      void flushCreds(session).catch((err) =>
        events.emit('error', { id: session.id, where: 'creds.update', err }),
      );
    });

    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        session.state = 'pairing';
        void saveWhatsAppQr(deps.db, { connectionId: session.id, qr }).catch((err) =>
          events.emit('error', { id: session.id, where: 'saveWhatsAppQr', err }),
        );
        events.emit('qr', { id: session.id, qr });
      }
      if (connection === 'connecting') {
        session.state = 'connecting';
        events.emit('status', { id: session.id, state: 'connecting' });
      }
      if (connection === 'open') {
        session.state = 'connected';
        events.emit('status', { id: session.id, state: 'connected' });
        const meJid = session.creds.me?.id ?? null;
        const phone = meJid ? (meJid.split(':')[0]?.split('@')[0] ?? null) : null;
        // Bind first if the connection was still 'pending' (so the
        // self-only filter in handleInboundMessages knows the owner
        // phone), then update the status + clear the QR. Both calls
        // are idempotent so racing the order doesn't matter.
        void Promise.all([
          saveWhatsAppQr(deps.db, { connectionId: session.id, qr: null }),
          phone
            ? bindExternalConnection(deps.db, { id: session.id, boundChatId: phone })
            : Promise.resolve(false),
          updateConnectionStatus(deps.db, {
            id: session.id,
            status: 'connected',
            error: null,
          }),
        ]).catch((err) => events.emit('error', { id: session.id, where: 'open', err }));
      }
      if (connection === 'close') {
        const code =
          (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
            ?.statusCode ?? 0;
        const loggedOut = code === DisconnectReason.loggedOut;
        // After the phone scans the QR, WhatsApp's server saves the
        // pairing and immediately closes the stream with code 515 (=
        // `DisconnectReason.restartRequired`). The protocol expects us
        // to dispose this socket and reopen with the now-saved creds —
        // ONLY after that re-handshake does the phone consider the
        // device "linked". If we don't reconnect, the user sees
        // "Couldn't link device" because we never confirmed.
        //
        // Connection-replaced (440) is the same shape — server is
        // telling us a newer socket has taken over, so reconnecting on
        // the *current* session would just keep losing the race. Skip
        // restart for that one.
        const restartRequired = code === DisconnectReason.restartRequired;
        const message =
          lastDisconnect?.error instanceof Error
            ? lastDisconnect.error.message
            : 'connection closed';
        events.emit('status', {
          id: session.id,
          state: loggedOut ? 'error' : restartRequired ? 'connecting' : 'idle',
          reason: message,
        });
        if (loggedOut) {
          // Device unlinked from the user's WhatsApp — auth state is
          // dead, future starts must repair.
          session.state = 'error';
          void updateConnectionStatus(deps.db, {
            id: session.id,
            status: 'error',
            error: 'WhatsApp device unlinked. Pair again from Settings → External.',
          }).catch(() => {});
          sessions.delete(session.id);
        } else if (restartRequired) {
          // The "this is normal, keep going" path. Drop the dead
          // socket and re-attach with the saved creds. We re-attach on
          // the same Session object so the keys cache stays warm.
          session.state = 'connecting';
          session.socket = null;
          // Defer one tick so the current event handler unwinds before
          // we open a new WebSocket — otherwise Baileys can race its
          // own teardown and we end up with two sockets emitting
          // events for the same session.
          setTimeout(() => {
            void (async () => {
              try {
                session.socket = await attachSocket(session);
              } catch (err) {
                events.emit('error', { id: session.id, where: 'restart', err });
                session.state = 'error';
                await updateConnectionStatus(deps.db, {
                  id: session.id,
                  status: 'error',
                  error:
                    err instanceof Error
                      ? `Reconnect after pairing failed: ${err.message}`
                      : 'Reconnect after pairing failed.',
                }).catch(() => {});
              }
            })();
          }, 250);
        } else {
          // Transient close (network blip, server-side conflict, etc.).
          // We don't auto-reconnect to avoid hot-loops on persistent
          // failures; the next `start(id)` call resumes from saved
          // creds. The dispatcher / UI can decide when to retry.
          session.state = 'idle';
          session.socket = null;
        }
      }
    });

    socket.ev.on('messages.upsert', (event) => {
      void handleInboundMessages(session, event).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(
          `[wa:upsert] handleInboundMessages threw conn=${session.id}:`,
          err instanceof Error ? (err.stack ?? err.message) : err,
        );
        events.emit('error', { id: session.id, where: 'messages.upsert', err });
      });
    });

    return socket;
  }

  async function handleInboundMessages(
    session: Session,
    event: { messages: Array<unknown>; type: string },
  ): Promise<void> {
    // Baileys emits `messages.upsert` with two event types:
    //   - 'notify'  → message arrived while online (from someone else)
    //   - 'append'  → message added to a chat WITHOUT notification —
    //                 typically a message YOU sent from another linked
    //                 device (e.g. your phone's WhatsApp app talking
    //                 to your phone's self-chat).
    //
    // The bot's whole job is the self-chat ("send a message to
    // yourself, get an agent reply"), and those land here as
    // `type: 'append'` with `key.fromMe: true`. The previous filter
    // (`type !== 'notify' return`) silently dropped every one of them
    // — which is why pairing succeeded but no replies came back.
    //
    // We still drop other types (Baileys may add new ones) and the
    // self-only filter below stays intact.
    if (event.type !== 'notify' && event.type !== 'append') {
      return;
    }
    const conn = await getExternalConnection(deps.db, session.id);
    if (!conn || conn.status === 'revoked') {
      return;
    }
    for (const m of event.messages) {
      const traceId = randomUUID().replace(/-/g, '').slice(0, 12);
      const msg = m as {
        key?: { fromMe?: boolean; remoteJid?: string; id?: string };
        messageTimestamp?: number | { low?: number; high?: number; toNumber?: () => number };
        message?: {
          conversation?: string;
          extendedTextMessage?: { text?: string };
          imageMessage?: { caption?: string };
          videoMessage?: { caption?: string };
          [k: string]: unknown;
        } | null;
        pushName?: string;
      };
      const text =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ??
        '';
      const jid = msg.key?.remoteJid ?? '';
      const fromSelf = !!msg.key?.fromMe;
      const meId = session.creds.me?.id;
      const meLid = session.creds.me?.lid;
      const mePnDigits = meId ? digitsOnly(meId.split(':')[0] ?? '') : '';
      const waMsgId = msg.key?.id ?? 'unknown';

      if (!jid) {
        continue;
      }

      if (isJidStatusBroadcast(jid) || isJidGroup(jid)) {
        continue;
      }

      if (!text || text.length === 0) {
        continue;
      }

      if (conn.boundChatId && mePnDigits && digitsOnly(conn.boundChatId) !== mePnDigits) {
        continue;
      }

      // Self-chat can arrive as PN (`234…@s.whatsapp.net`) or LID
      // (`237…@lid`) depending on WhatsApp's routing. Comparing raw
      // digits to bound_chat_id breaks the LID case — use Baileys'
      // `me.id` / `me.lid` identity instead.
      const isSelfChat =
        fromSelf &&
        ((!!meId && areJidsSameUser(jid, meId)) || (!!meLid && areJidsSameUser(jid, meLid)));
      if (!isSelfChat) {
        continue;
      }

      const stableOwnerPn = conn.boundChatId ?? mePnDigits;
      if (!stableOwnerPn) {
        continue;
      }

      if (isWhatsAppOutboundEcho(conn.id, waMsgId)) {
        continue;
      }

      if (isDuplicateInboundStanza(conn.id, waMsgId)) {
        continue;
      }

      // Recency guard: Baileys can replay buffered messages from
      // before pairing in the first 'append' batch after the socket
      // opens. If the agent acted on those, the user would see the
      // bot suddenly respond to a message they sent days ago. 5
      // minutes is a generous cutoff that still lets normal in-flight
      // messages through.
      const ts = readMessageTimestamp(msg.messageTimestamp);
      if (ts !== null) {
        const ageMs = Date.now() - ts * 1000;
        if (ageMs > 5 * 60 * 1000) {
          continue;
        }
      }

      await touchConnectionLastSeen(deps.db, conn.id).catch(() => {});
      await recordExternalMessage(deps.db, {
        connectionId: conn.id,
        direction: 'inbound',
        payload: {
          from_id: stableOwnerPn,
          text_len: text.length,
          channel: 'whatsapp',
          trace_id: traceId,
        },
      });
      if (!session.socket) {
        continue;
      }
      try {
        await deps.onInboundMessage({
          connection: conn,
          message: text,
          fromId: stableOwnerPn,
          traceId,
          socket: session.socket,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[wa:msg] trace=${traceId} dispatch_error conn=${conn.id}:`,
          err instanceof Error ? (err.stack ?? err.message) : err,
        );
        throw err;
      }
    }
  }

  /**
   * Baileys serialises `messageTimestamp` as either a plain JS number
   * (after BufferJSON revival) or a protobuf Long ({low, high} or
   * `{toNumber()}`). Normalise to a unix-seconds number; return null
   * if the field is missing.
   */
  function readMessageTimestamp(
    raw: number | { low?: number; high?: number; toNumber?: () => number } | undefined,
  ): number | null {
    if (raw == null) return null;
    if (typeof raw === 'number') return raw;
    if (typeof raw.toNumber === 'function') {
      try {
        return raw.toNumber();
      } catch {
        return null;
      }
    }
    if (typeof raw.low === 'number') return raw.low;
    return null;
  }

  async function getOrCreateSession(connectionId: string): Promise<Session> {
    const existing = sessions.get(connectionId);
    if (existing) return existing;
    const { creds, keys } = await loadOrInit(connectionId);
    const session: Session = {
      id: connectionId,
      socket: null,
      state: 'idle',
      creds,
      keys,
      keysSaveTimer: null,
      keysDirty: false,
    };
    sessions.set(connectionId, session);
    return session;
  }

  return {
    async start(connectionId) {
      try {
        const session = await getOrCreateSession(connectionId);
        // Already healthy — return current state without churning the
        // socket. This is what the BFF poll hits on every refresh; we
        // don't want to re-handshake on every poll.
        if (session.socket && (session.state === 'connected' || session.state === 'pairing')) {
          return { status: session.state === 'connected' ? 'connected' : 'pairing' };
        }
        // Mid-restart (515 reconnect in flight) — let the in-flight
        // attach finish instead of opening a SECOND socket which
        // would race with the first and trigger `conflict/replaced`
        // (the exact failure the previous session hit). The UI
        // continues polling /qr until status flips to 'connected'.
        if (session.state === 'connecting') {
          return { status: 'pairing' };
        }
        // Defensive: if a stale socket is still flapping, force-close
        // it before opening a new one so we don't hold a zombie WS
        // connection that competes with the new pairing attempt.
        if (session.socket) {
          try {
            session.socket.end(undefined);
          } catch {
            /* ignore */
          }
          session.socket = null;
        }
        session.socket = await attachSocket(session);
        return { status: session.creds.registered ? 'connected' : 'pairing' };
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown';
        return { status: 'error', reason };
      }
    },

    async stop(connectionId, opts) {
      const session = sessions.get(connectionId);
      if (!session) return;
      try {
        if (session.socket) {
          if (opts?.logout) {
            await session.socket.logout('connection revoked').catch(() => {});
          } else {
            session.socket.end(undefined);
          }
        }
      } finally {
        if (session.keysSaveTimer) clearTimeout(session.keysSaveTimer);
        recentInboundStanzaIds.delete(connectionId);
        clearWhatsAppOutboundEcho(connectionId);
        sessions.delete(connectionId);
      }
    },

    getStatus(connectionId) {
      return sessions.get(connectionId)?.state ?? 'idle';
    },

    async sendOutboundText(connectionId, text) {
      const session = sessions.get(connectionId);
      if (!session?.socket || session.state !== 'connected') {
        return false;
      }
      const conn = await getExternalConnection(deps.db, connectionId);
      const rawTarget = conn?.boundChatId?.trim();
      if (!rawTarget) {
        return false;
      }
      try {
        const jid = waJidForPhone(rawTarget);
        const result = (await session.socket.sendMessage(jid, { text })) as
          | { key?: { id?: string } }
          | undefined;
        registerWhatsAppOutboundStanza(connectionId, result?.key?.id);
        return true;
      } catch {
        return false;
      }
    },

    events,
  };
}

/**
 * Module-level cache for the Baileys protocol version. The CDN fetch
 * is shared across every session in the process — there's no reason
 * to re-resolve it per `start()`. The 6h TTL covers the case where
 * Baileys publishes an update we want to pick up without restarting
 * the API.
 */
const BAILEYS_VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const FALLBACK_BAILEYS_VERSION: [number, number, number] = [2, 3000, 0];
let baileysVersionCache: { value: [number, number, number]; fetchedAt: number } | null = null;

async function getCachedBaileysVersion(): Promise<[number, number, number]> {
  const now = Date.now();
  if (baileysVersionCache && now - baileysVersionCache.fetchedAt < BAILEYS_VERSION_TTL_MS) {
    return baileysVersionCache.value;
  }
  try {
    const { version } = await fetchLatestBaileysVersion();
    baileysVersionCache = { value: version, fetchedAt: now };
    return version;
  } catch {
    // CDN unreachable — fall back to a known-good version. We DON'T
    // cache the fallback so the next start() retries. Baileys is
    // tolerant of slightly stale versions; this only matters during
    // protocol bumps.
    return FALLBACK_BAILEYS_VERSION;
  }
}

/**
 * Lazy module-level singleton. Only exported via `getWhatsAppManager`
 * so callers can't accidentally instantiate two — Baileys would not
 * tolerate dual sockets on the same auth state.
 */
let cached: WhatsAppManager | null = null;

export function getWhatsAppManager(deps: WhatsAppManagerDeps): WhatsAppManager {
  if (cached) return cached;
  cached = createWhatsAppManager(deps);
  return cached;
}

export function _resetWhatsAppManagerForTests(): void {
  cached = null;
  recentInboundStanzaIds.clear();
  resetWhatsAppOutboundEchoForTests();
}
