/**
 * When we `sendMessage` into the user's self-chat, Baileys soon emits a
 * `messages.upsert` for that same stanza (`fromMe: true`). Without
 * filtering, the inbound pipeline treats it as a new user message and
 * runs the agent again → repeated / runaway replies.
 */

const ECHO_TTL_MS = 5 * 60 * 1000;
const ECHO_MAX_IDS = 2000;

const outboundEchoByConnection = new Map<string, Map<string, number>>();

function pruneEchoMap(inner: Map<string, number>, now: number): void {
  for (const [id, t] of inner) {
    if (now - t > ECHO_TTL_MS) inner.delete(id);
  }
  if (inner.size > ECHO_MAX_IDS) {
    const entries = [...inner.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < entries.length - 1000; i++) {
      inner.delete(entries[i][0]);
    }
  }
}

/**
 * Call after every successful `sendMessage` so the echo upsert is ignored.
 */
export function registerWhatsAppOutboundStanza(
  connectionId: string,
  stanzaId: string | undefined,
): void {
  if (!stanzaId || stanzaId === 'unknown') return;
  const now = Date.now();
  let inner = outboundEchoByConnection.get(connectionId);
  if (!inner) {
    inner = new Map();
    outboundEchoByConnection.set(connectionId, inner);
  }
  inner.set(stanzaId, now);
  pruneEchoMap(inner, now);
}

/**
 * True if this inbound stanza is our own outgoing reply (echo).
 */
export function isWhatsAppOutboundEcho(
  connectionId: string,
  stanzaId: string | undefined,
): boolean {
  if (!stanzaId || stanzaId === 'unknown') return false;
  const inner = outboundEchoByConnection.get(connectionId);
  if (!inner) return false;
  const t = inner.get(stanzaId);
  if (t === undefined) return false;
  if (Date.now() - t > ECHO_TTL_MS) {
    inner.delete(stanzaId);
    return false;
  }
  return true;
}

export function clearWhatsAppOutboundEcho(connectionId: string): void {
  outboundEchoByConnection.delete(connectionId);
}

export function resetWhatsAppOutboundEchoForTests(): void {
  outboundEchoByConnection.clear();
}
