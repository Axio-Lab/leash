'use client';

import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export function JsonViewer({
  data,
  className,
  maxHeight = '24rem',
}: {
  data: unknown;
  className?: string;
  maxHeight?: string;
}) {
  const text = React.useMemo(() => JSON.stringify(data, null, 2), [data]);
  const [copied, setCopied] = React.useState(false);

  return (
    <div
      className={cn('relative group rounded-md border border-border bg-bg-elev-2/70', className)}
    >
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded border border-border bg-bg-elev text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
        aria-label="Copy JSON"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
      <pre
        className="overflow-auto p-4 font-mono text-[12px] leading-relaxed text-fg"
        style={{ maxHeight }}
      >
        {text}
      </pre>
    </div>
  );
}
