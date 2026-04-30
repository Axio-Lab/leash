/**
 * Browser-resident chat threads/messages, keyed per Privy user id.
 */

import { z } from 'zod';

export type ChatRole = 'user' | 'assistant' | 'system';

const ChatArtifactSchema = z.object({
  kind: z.enum(['payment_link', 'payment_request', 'receipt', 'tool_call']),
  payload: z.record(z.string(), z.unknown()),
});

export type ChatArtifact = z.infer<typeof ChatArtifactSchema>;

const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  artifacts: z.array(ChatArtifactSchema).optional(),
  createdAt: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

const ChatThreadSchema = z.object({
  id: z.string(),
  agentMint: z.string().optional(),
  title: z.string(),
  messages: z.array(ChatMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ChatThread = z.infer<typeof ChatThreadSchema>;

let activePrivyId: string | null = null;

export function setActiveUser(privyId: string | null): void {
  activePrivyId = privyId;
}

export function getActiveUser(): string | null {
  return activePrivyId;
}

function prefix(privyId: string): string {
  return `chat:${privyId}:`;
}

function threadsIndexKey(privyId: string): string {
  return `${prefix(privyId)}thread_ids`;
}

function threadKey(privyId: string, threadId: string): string {
  return `${prefix(privyId)}thread:${threadId}`;
}

function safeParseThread(raw: string | null): ChatThread | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const r = ChatThreadSchema.safeParse(parsed);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function listThreads(privyId: string): ChatThread[] {
  if (typeof window === 'undefined') return [];
  try {
    const idsRaw = localStorage.getItem(threadsIndexKey(privyId));
    const ids: string[] = idsRaw ? (JSON.parse(idsRaw) as string[]) : [];
    const out: ChatThread[] = [];
    for (const id of ids) {
      const t = loadThread(privyId, id);
      if (t) out.push(t);
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}

export function loadThread(privyId: string, threadId: string): ChatThread | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(threadKey(privyId, threadId));
  return safeParseThread(raw);
}

export function createThread(
  privyId: string,
  options: { title?: string; agentMint?: string } | string = {},
): ChatThread {
  const opts = typeof options === 'string' ? { title: options } : options;
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  const thread: ChatThread = {
    id,
    title: opts.title?.trim() || 'New chat',
    ...(opts.agentMint ? { agentMint: opts.agentMint } : {}),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  persistThread(privyId, thread);
  const idsRaw = localStorage.getItem(threadsIndexKey(privyId));
  const ids: string[] = idsRaw ? (JSON.parse(idsRaw) as string[]) : [];
  if (!ids.includes(id)) {
    ids.unshift(id);
    localStorage.setItem(threadsIndexKey(privyId), JSON.stringify(ids));
  }
  return thread;
}

/**
 * Stamp `agentMint` onto a thread that didn't have one (e.g. created from
 * the sidebar before primary-mint attachment was wired). No-op if the
 * thread is missing or already linked.
 */
export function setThreadAgentMint(privyId: string, threadId: string, agentMint: string): void {
  const thread = loadThread(privyId, threadId);
  if (!thread) return;
  if (thread.agentMint === agentMint) return;
  thread.agentMint = agentMint;
  persistThread(privyId, thread);
}

function persistThread(privyId: string, thread: ChatThread): void {
  localStorage.setItem(threadKey(privyId, thread.id), JSON.stringify(thread));
}

export function appendMessage(
  privyId: string,
  threadId: string,
  msg: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): ChatMessage {
  const thread = loadThread(privyId, threadId);
  if (!thread) throw new Error(`thread not found: ${threadId}`);
  const now = new Date().toISOString();
  const full: ChatMessage = {
    id: msg.id ?? crypto.randomUUID?.() ?? `m_${Date.now()}`,
    role: msg.role,
    content: msg.content,
    artifacts: msg.artifacts,
    createdAt: msg.createdAt ?? now,
  };
  thread.messages.push(full);
  thread.updatedAt = now;
  if (thread.messages.length === 1 && msg.role === 'user') {
    const snippet = msg.content.trim().slice(0, 48);
    if (snippet) thread.title = snippet + (msg.content.length > 48 ? '…' : '');
  }
  persistThread(privyId, thread);
  return full;
}

export function updateLastAssistantMessage(
  privyId: string,
  threadId: string,
  patch: Partial<Pick<ChatMessage, 'content' | 'artifacts'>>,
): void {
  const thread = loadThread(privyId, threadId);
  if (!thread?.messages.length) return;
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    if (thread.messages[i]!.role === 'assistant') {
      thread.messages[i] = { ...thread.messages[i]!, ...patch };
      thread.updatedAt = new Date().toISOString();
      persistThread(privyId, thread);
      return;
    }
  }
}

/**
 * Persist the settled `tx_sig` + `receipt_hash` onto every
 * `payment_request` artifact in the thread that targets `url`. We
 * stamp the artifact payload itself (rather than a side-store) so the
 * Pay card can hydrate to its "Payment confirmed" state on full page
 * refresh — no lookup needed, the artifact is the source of truth.
 *
 * Matching by `url` is intentional: the same payment-link URL paid
 * twice in the same thread is conceptually the same intent, and we'd
 * rather show "paid" on both than re-prompt the user.
 */
export function markPayRequestPaid(
  privyId: string,
  threadId: string,
  url: string,
  paid: { tx_sig: string; receipt_hash: string },
): void {
  const thread = loadThread(privyId, threadId);
  if (!thread) return;
  let dirty = false;
  for (const m of thread.messages) {
    if (!m.artifacts) continue;
    for (const a of m.artifacts) {
      if (a.kind !== 'payment_request') continue;
      const payload = a.payload as Record<string, unknown> & { url?: string };
      if (payload.url !== url) continue;
      payload.paid_tx_sig = paid.tx_sig;
      payload.paid_receipt_hash = paid.receipt_hash;
      dirty = true;
    }
  }
  if (dirty) {
    thread.updatedAt = new Date().toISOString();
    persistThread(privyId, thread);
  }
}

export function renameThread(privyId: string, threadId: string, title: string): void {
  const thread = loadThread(privyId, threadId);
  if (!thread) return;
  thread.title = title.trim() || thread.title;
  thread.updatedAt = new Date().toISOString();
  persistThread(privyId, thread);
}

export function deleteThread(privyId: string, threadId: string): void {
  localStorage.removeItem(threadKey(privyId, threadId));
  const idsRaw = localStorage.getItem(threadsIndexKey(privyId));
  const ids: string[] = idsRaw ? (JSON.parse(idsRaw) as string[]) : [];
  const next = ids.filter((x) => x !== threadId);
  localStorage.setItem(threadsIndexKey(privyId), JSON.stringify(next));
}

/**
 * Wipe every chat thread for `privyId`. Returns the number of threads
 * removed so the caller can surface a precise toast.
 *
 * Persisted artifacts (Pay card receipts, payment-link cards) live
 * inside the threads themselves, so this is a clean reset — the on-
 * chain receipts on the explorer are untouched.
 */
export function clearAllThreads(privyId: string): number {
  if (typeof window === 'undefined') return 0;
  const idsRaw = localStorage.getItem(threadsIndexKey(privyId));
  const ids: string[] = idsRaw ? (JSON.parse(idsRaw) as string[]) : [];
  for (const id of ids) {
    localStorage.removeItem(threadKey(privyId, id));
  }
  localStorage.setItem(threadsIndexKey(privyId), JSON.stringify([]));
  return ids.length;
}
