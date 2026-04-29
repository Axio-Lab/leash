'use client';

import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { Composer } from '@/components/chat/composer';
import { MessageList } from '@/components/chat/message-list';
import type { AgentEvent } from '@/lib/agents/types';
import { favoritesJsonForHeader } from '@/lib/favorites';
import {
  appendMessage,
  loadThread,
  updateLastAssistantMessage,
  type ChatArtifact,
  type ChatMessage,
} from '@/lib/chat-storage';
import { skillsJsonForHeader } from '@/lib/skills';
import { streamAgentEvents } from '@/lib/chat-stream';

function messagesForApi(
  messages: ChatMessage[],
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export default function AgentsThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, getAccessToken } = usePrivy();
  const router = useRouter();
  const pid = user?.id ?? '';
  const [messages, setMessages] = useState(() =>
    pid ? (loadThread(pid, id)?.messages ?? []) : [],
  );

  useEffect(() => {
    if (!pid) return;
    const t = loadThread(pid, id);
    if (!t) {
      router.replace('/agents');
      return;
    }
    setMessages(t.messages);
  }, [pid, id, router]);

  const onSend = useCallback(
    async (text: string) => {
      if (!pid) return;

      appendMessage(pid, id, { role: 'user', content: text });
      const threadAfterUser = loadThread(pid, id);
      const apiMessages = messagesForApi(threadAfterUser?.messages ?? []);
      appendMessage(pid, id, { role: 'assistant', content: '' });
      setMessages(loadThread(pid, id)?.messages ?? []);

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      try {
        const token = await getAccessToken?.();
        if (token) headers.authorization = `Bearer ${token}`;
      } catch {
        /* cookie fallback */
      }

      const sf = skillsJsonForHeader(pid);
      const ff = favoritesJsonForHeader(pid);
      if (sf) headers['x-leash-skills'] = sf;
      if (ff) headers['x-leash-favorites'] = ff;

      const threadMeta = loadThread(pid, id);

      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          threadId: id,
          agentMint: threadMeta?.agentMint,
          messages: apiMessages,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        updateLastAssistantMessage(pid, id, {
          content: `Sorry — chat request failed (${res.status}). ${errText.slice(0, 200)}`,
        });
        setMessages(loadThread(pid, id)?.messages ?? []);
        return;
      }

      let acc = '';
      const artifacts: ChatArtifact[] = [];

      function applyAssistantPatch(patch: { content?: string; artifacts?: ChatArtifact[] }) {
        updateLastAssistantMessage(pid, id, patch);
        setMessages(loadThread(pid, id)?.messages ?? []);
      }

      try {
        for await (const ev of streamAgentEvents(res)) {
          const typed = ev as AgentEvent;
          if (typed.type === 'token') {
            acc += typed.text;
            applyAssistantPatch({ content: acc });
          } else if (typed.type === 'artifact') {
            artifacts.push(typed.artifact as ChatArtifact);
            applyAssistantPatch({ content: acc, artifacts: [...artifacts] });
          } else if (typed.type === 'tool_use') {
            artifacts.push({
              kind: 'tool_call',
              payload: { name: typed.name, input: typed.input },
            });
            applyAssistantPatch({ content: acc, artifacts: [...artifacts] });
          } else if (typed.type === 'error') {
            acc += `\n\n⚠ ${typed.message}`;
            applyAssistantPatch({ content: acc, artifacts: [...artifacts] });
          } else if (typed.type === 'warning') {
            acc += `\n\n${typed.message}`;
            applyAssistantPatch({ content: acc, artifacts: [...artifacts] });
          }
          // done — noop; stream ends
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        applyAssistantPatch({
          content: acc ? `${acc}\n\n(Stream error: ${msg})` : `Stream error: ${msg}`,
          artifacts: [...artifacts],
        });
      }
    },
    [getAccessToken, id, pid],
  );

  return (
    <>
      <MessageList messages={messages} />
      <Composer onSend={onSend} disabled={!pid} />
    </>
  );
}
