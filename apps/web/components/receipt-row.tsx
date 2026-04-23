'use client';

import * as React from 'react';
import type { ReceiptV1 } from '@leash/schemas';
import { formatReceiptPriceUsd, formatReceiptPriceWithCurrency } from '@/lib/format-receipt-price';
import { Badge } from '@/components/ui/badge';
import { JsonViewer } from '@/components/json-viewer';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { transactionExplorerUrl } from '@/lib/solscan';

export function ReceiptRow({ receipt }: { receipt: ReceiptV1 }) {
  const [open, setOpen] = React.useState(false);
  const { kind, decision, request, price, ts, receipt_hash, tx_sig } = receipt;
  // Default to devnet when the receipt didn't carry a network (older
  // receipts pre-`price.network`). Devnet is the only supported playground
  // cluster today so this is the safe assumption.
  const network = price?.network ?? 'solana-devnet';
  const txUrl = tx_sig ? transactionExplorerUrl(network, tx_sig) : null;
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
        <Badge
          variant={
            decision === 'allow' ? 'outline' : decision === 'rejected' ? 'warning' : 'danger'
          }
          title={
            decision === 'rejected'
              ? 'Policy allowed the call but settlement failed (insufficient balance, facilitator/RPC error, etc).'
              : decision === 'deny'
                ? 'Blocked by the policy gate before any payment was attempted.'
                : 'Policy allowed the call and (for spend receipts) the payment settled.'
          }
        >
          {decision}
        </Badge>
        <span className="font-mono text-xs text-fg-muted truncate">
          {request.method} {request.url}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-fg-subtle">
          {price ? (
            <span
              className="font-mono text-fg"
              title={`${formatReceiptPriceWithCurrency(price)} · ${price.amount} atomic`}
            >
              {formatReceiptPriceUsd(price)}
            </span>
          ) : null}
          <span title={new Date(ts).toISOString()}>{formatReceiptTs(ts)}</span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-border p-3 flex flex-col gap-2">
          <div className="text-[10px] font-mono text-fg-subtle">receipt_hash {receipt_hash}</div>
          {txUrl ? (
            <a
              href={txUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline w-fit font-mono"
              title={tx_sig ?? undefined}
            >
              <ExternalLink className="size-3" />
              View txn on Solscan{' '}
              <span className="text-fg-subtle">
                ({tx_sig?.slice(0, 8)}…{tx_sig?.slice(-4)})
              </span>
            </a>
          ) : (
            <span className="text-[11px] text-fg-subtle">
              No tx signature on this receipt — call did not settle.
            </span>
          )}
          <JsonViewer data={receipt} maxHeight="20rem" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Always include year + month + day so receipts feed at-a-glance
 * disambiguates payments across calendar years (e.g. "22 Apr 2026, 22:01").
 * Tooltip on the row keeps the full ISO string for power users.
 */
function formatReceiptTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
