'use client';

import * as React from 'react';

import { ChatInput, ChatInputSubmit, ChatInputTextArea } from '@/components/ui/chat-input';

export function Composer({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (text: string) => void | Promise<void>;
}) {
  const [value, setValue] = React.useState('');
  const [pending, setPending] = React.useState(false);

  async function send() {
    const t = value.trim();
    if (!t || pending || disabled) return;
    setPending(true);
    setValue('');
    try {
      await onSend(t);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="shrink-0 border-t border-border bg-bg/70 backdrop-blur-md">
      <div className="mx-auto w-full max-w-3xl px-3 sm:px-4 py-3 sm:py-4">
        <ChatInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onSubmit={() => void send()}
          loading={pending}
          rows={1}
        >
          <ChatInputTextArea
            placeholder="Type a command or ask a question"
            disabled={disabled || pending}
          />
          <ChatInputSubmit />
        </ChatInput>
      </div>
    </div>
  );
}
