/**
 * Short-lived transcript for external chat (Telegram / WhatsApp).
 *
 * Server-side `/api/agents/run` has no browser localStorage — without
 * this, every inbound message is an isolated turn and follow-ups like
 * "is it done?" have zero context. We keep a bounded rolling window in
 * the API cache (Redis or in-memory) keyed by `external_connections.id`.
 */

import type { CacheClient } from '../storage/redis.js';

const KEY_PREFIX = 'ext:conv:v1:';
const TTL_SEC = 172800; /** 48h */
const MAX_MESSAGES = 12;
const MAX_CONTENT = 1800;

export type ExternalConvTurn = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

function trimContent(s: string): string {
  const t = s.trim();
  if (t.length <= MAX_CONTENT) return t;
  return `${t.slice(0, MAX_CONTENT)}…`;
}

export async function loadExternalConversation(
  cache: CacheClient,
  connectionId: string,
): Promise<ExternalConvTurn[]> {
  const raw = await cache.get(KEY_PREFIX + connectionId);
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as { v?: number; m?: ExternalConvTurn[] };
    if (j.v !== 1 || !Array.isArray(j.m)) return [];
    return j.m.filter(
      (t) =>
        t &&
        (t.role === 'user' || t.role === 'assistant' || t.role === 'system') &&
        typeof t.content === 'string',
    );
  } catch {
    return [];
  }
}

async function saveExternalConversation(
  cache: CacheClient,
  connectionId: string,
  messages: ExternalConvTurn[],
): Promise<void> {
  const trimmed = messages.slice(-MAX_MESSAGES);
  await cache.set(KEY_PREFIX + connectionId, JSON.stringify({ v: 1, m: trimmed }), {
    ttlSec: TTL_SEC,
  });
}

export async function appendExternalExchange(
  cache: CacheClient,
  connectionId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const prev = await loadExternalConversation(cache, connectionId);
  const next = [
    ...prev,
    { role: 'user' as const, content: trimContent(userContent) },
    { role: 'assistant' as const, content: trimContent(assistantContent) },
  ];
  await saveExternalConversation(cache, connectionId, next);
}

export async function appendExternalAssistantLine(
  cache: CacheClient,
  connectionId: string,
  content: string,
): Promise<void> {
  const prev = await loadExternalConversation(cache, connectionId);
  const next = [...prev, { role: 'assistant' as const, content: trimContent(content) }];
  await saveExternalConversation(cache, connectionId, next);
}
