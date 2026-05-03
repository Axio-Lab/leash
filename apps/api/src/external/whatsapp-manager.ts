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

import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  makeWASocket,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type WASocket,
} from 'baileys';
import { BufferJSON, proto } from 'baileys';

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
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 0] as [number, number, number],
    }));
    const auth = buildAuthState(session);
    const socket = makeWASocket({
      version,
      auth,
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
        const message =
          lastDisconnect?.error instanceof Error
            ? lastDisconnect.error.message
            : 'connection closed';
        events.emit('status', {
          id: session.id,
          state: loggedOut ? 'error' : 'idle',
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
        } else {
          // Transient close — Baileys will not auto-reconnect; the user
          // can re-open by re-clicking "Add WhatsApp" or the dispatcher
          // can resume on next inbound. We don't auto-reconnect here
          // to avoid hot-loops on persistent network failures.
          session.state = 'idle';
          session.socket = null;
        }
      }
    });

    socket.ev.on('messages.upsert', (event) => {
      void handleInboundMessages(session, event).catch((err) =>
        events.emit('error', { id: session.id, where: 'messages.upsert', err }),
      );
    });

    return socket;
  }

  async function handleInboundMessages(
    session: Session,
    event: { messages: Array<unknown>; type: string },
  ): Promise<void> {
    if (event.type !== 'notify') return;
    const conn = await getExternalConnection(deps.db, session.id);
    if (!conn || conn.status === 'revoked') return;
    for (const m of event.messages) {
      const msg = m as {
        key?: { fromMe?: boolean; remoteJid?: string };
        message?: { conversation?: string; extendedTextMessage?: { text?: string } } | null;
      };
      const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? '';
      if (!text || text.length === 0) continue;
      const jid = msg.key?.remoteJid ?? '';
      const fromSelf = !!msg.key?.fromMe;
      const phone = jid.split('@')[0]?.split(':')[0] ?? '';

      // Strict self-only filter (mirrors the user's spec: "in
      // whatsapp it will only process message to myself from
      // myself"). The bound_chat_id is the bot owner's number; we
      // accept messages from that number sent in the self-chat
      // (jid ends with @s.whatsapp.net AND fromMe=true OR remote=self).
      const ownerPhone =
        conn.boundChatId ?? session.creds.me?.id?.split(':')[0]?.split('@')[0] ?? '';
      if (!ownerPhone || phone !== ownerPhone) continue;
      if (!fromSelf) continue;

      await touchConnectionLastSeen(deps.db, conn.id).catch(() => {});
      await recordExternalMessage(deps.db, {
        connectionId: conn.id,
        direction: 'inbound',
        payload: { from_id: phone, text_len: text.length, channel: 'whatsapp' },
      });
      if (session.socket) {
        await deps.onInboundMessage({
          connection: conn,
          message: text,
          fromId: phone,
          socket: session.socket,
        });
      }
    }
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
        if (session.socket && (session.state === 'connected' || session.state === 'pairing')) {
          return { status: session.state === 'connected' ? 'connected' : 'pairing' };
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
        sessions.delete(connectionId);
      }
    },

    getStatus(connectionId) {
      return sessions.get(connectionId)?.state ?? 'idle';
    },

    events,
  };
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
}
