'use client';

import * as React from 'react';
import type { ReceiptV1 } from '@leash/schemas';
import { Badge } from '@/components/ui/badge';
import { JsonViewer } from '@/components/json-viewer';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export function ReceiptRow({ receipt }: { receipt: ReceiptV1 }) {
  const [open, setOpen] = React.useState(false);
  const { kind, decision, request, price, ts, nonce, receipt_hash } = receipt;
  return (
    <div className="rounded-md border border-border bg-bg-elev/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-bg-elev"
      >
        <ChevronRight
          className={cn('size-4 text-fg-subtle transition-transform', open && 'rotate-90')}
        />
        <Badge variant={kind === 'earn' ? 'success' : 'brand'}>{kind}</Badge>
        <Badge variant={decision === 'allow' ? 'outline' : 'danger'}>{decision}</Badge>
        <span className="font-mono text-xs text-fg-muted truncate">
          {request.method} {request.url}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-fg-subtle">
          {price ? (
            <span className="font-mono text-fg">
              {price.amount} {price.currency}
            </span>
          ) : null}
          <span>#{nonce}</span>
          <span>{new Date(ts).toLocaleTimeString()}</span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-border p-3">
          <div className="text-[10px] font-mono text-fg-subtle mb-2">
            receipt_hash {receipt_hash}
          </div>
          <JsonViewer data={receipt} maxHeight="20rem" />
        </div>
      ) : null}
    </div>
  );
}
