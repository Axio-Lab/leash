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
