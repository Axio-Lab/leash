'use client';

import { motion } from 'motion/react';

import type { ChatMessage } from '@/lib/chat-storage';
import { Spinner } from '@/components/ui/spinner';

import { ArtifactCard } from './artifact-card';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center"
        >
          <motion.h1
            initial={{ backgroundPosition: '0% 50%' }}
            animate={{ backgroundPosition: '200% 50%' }}
            transition={{ duration: 6, repeat: Infinity, repeatType: 'reverse', ease: 'linear' }}
            className="text-3xl sm:text-4xl font-medium tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white/95 via-white/55 to-white/40 [background-size:200%_auto] pb-1"
          >
            How can I help today?
          </motion.h1>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-3xl px-3 sm:px-5 py-4 sm:py-6 space-y-4 sm:space-y-5">
        {messages.map((m) => {
          const isUser = m.role === 'user';
          const isStreaming =
            !isUser && m.content === '' && (!m.artifacts || m.artifacts.length === 0);
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={isUser ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={
                  isUser
                    ? 'max-w-[88%] sm:max-w-[78%] rounded-2xl rounded-br-md bg-brand/15 border border-brand/30 px-3.5 sm:px-4 py-2.5 text-sm text-fg shadow-sm'
                    : 'max-w-[94%] sm:max-w-[88%] rounded-2xl rounded-bl-md border border-border bg-bg-elev/70 backdrop-blur-md px-3.5 sm:px-4 py-2.5 text-sm text-fg'
                }
              >
                {isStreaming ? (
                  <div className="flex items-center gap-2 text-fg-muted py-1">
                    <Spinner size="sm" brand />
                    <span className="text-xs">Thinking…</span>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                    {m.content}
                  </div>
                )}
                {m.artifacts && m.artifacts.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {m.artifacts.map((a, i) => (
                      <ArtifactCard key={i} artifact={a} />
                    ))}
                  </div>
                ) : null}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
