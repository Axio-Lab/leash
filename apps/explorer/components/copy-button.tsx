'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={label}
      title={copied ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-md border border-[--color-border] bg-[--color-bg-elev]/60 p-1 text-[--color-fg-muted] backdrop-blur-md transition-all hover:border-[--color-border-strong] hover:bg-[--color-bg-elev-2]/80 hover:text-[--color-fg]',
        copied && 'border-[--color-success] text-[--color-success]',
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
