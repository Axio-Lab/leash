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
        'inline-flex items-center justify-center rounded-md border border-[--color-border] bg-[--color-bg-elev] p-1 text-[--color-fg-muted] hover:text-[--color-fg] transition-colors',
        copied && 'text-[--color-success] border-[--color-success]',
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
