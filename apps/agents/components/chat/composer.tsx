'use client';

import { LoaderIcon, SendIcon } from 'lucide-react';
import { motion } from 'motion/react';
import * as React from 'react';

import { cn } from '@/lib/cn';

export function Composer({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (text: string) => void | Promise<void>;
}) {
  const [value, setValue] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const ta = React.useRef<HTMLTextAreaElement>(null);

  async function send() {
    const t = value.trim();
    if (!t || pending || disabled) return;
    setPending(true);
    setValue('');
    try {
      await onSend(t);
    } finally {
      setPending(false);
      ta.current?.focus();
    }
  }

  return (
    <div className="shrink-0 border-t border-border p-3 sm:p-4 chat-glass w-full max-w-3xl mx-auto">
      <div className="flex gap-2 sm:gap-3 items-end">
        <textarea
          ref={ta}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          disabled={disabled || pending}
          placeholder="Message your agent…"
          className={cn(
            'flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-fg',
            'placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40',
            'min-h-[44px] max-h-40',
          )}
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => void send()}
          disabled={!value.trim() || pending || disabled}
          className={cn(
            'shrink-0 inline-flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2.5 text-sm font-medium',
            value.trim() && !pending
              ? 'bg-brand text-white hover:bg-brand-strong'
              : 'bg-bg-elev text-fg-subtle cursor-not-allowed',
          )}
        >
          {pending ? (
            <LoaderIcon className="size-4 animate-spin" />
          ) : (
            <SendIcon className="size-4" />
          )}
          <span className="hidden sm:inline">Send</span>
        </motion.button>
      </div>
    </div>
  );
}
