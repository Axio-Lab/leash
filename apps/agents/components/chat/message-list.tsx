'use client';

import { motion } from 'motion/react';

import type { ChatMessage } from '@/lib/chat-storage';

import { ArtifactCard } from './artifact-card';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16 text-center text-sm text-fg-muted">
        <p className="max-w-md">
          Ask anything — tools, payments, and marketplace listings wire up in later phases. Try the
          composer below.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6 max-w-3xl mx-auto w-full">
      {messages.map((m) => (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className={
            m.role === 'user'
              ? 'ml-auto max-w-[92%] sm:max-w-[85%] rounded-xl bg-brand/15 border border-brand/25 px-3 sm:px-4 py-2.5 text-sm text-fg'
              : 'mr-auto max-w-[96%] sm:max-w-[90%] rounded-xl border border-border bg-bg-elev px-3 sm:px-4 py-2.5 text-sm text-fg'
          }
        >
          <div className="whitespace-pre-wrap">{m.content}</div>
          {m.artifacts && m.artifacts.length > 0 ? (
            <div className="mt-3 space-y-2">
              {m.artifacts.map((a, i) => (
                <ArtifactCard key={i} artifact={a} />
              ))}
            </div>
          ) : null}
        </motion.div>
      ))}
    </div>
  );
}
