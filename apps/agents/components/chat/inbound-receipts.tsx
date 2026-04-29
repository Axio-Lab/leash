'use client';

import Link from 'next/link';
import useSWR from 'swr';

import { receiptUrl, shortHash, txUrl } from '@/lib/explorer';

type ReceiptItem = {
  receipt_hash?: string;
  tx_sig?: string | null;
};

export function InboundReceipts({ agentMint }: { agentMint: string | null }) {
  const { data } = useSWR(
    agentMint ? `/api/receipts/${encodeURIComponent(agentMint)}?limit=5` : null,
    async (url: string) => {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return { items: [] as ReceiptItem[] };
      return res.json() as Promise<{ items?: ReceiptItem[] }>;
    },
    { refreshInterval: 5000 },
  );

  const items = data?.items ?? [];
  if (!agentMint || items.length === 0) return null;

  return (
    <div className="shrink-0 px-4 py-2 border-b border-border bg-bg-elev/90 text-xs space-y-1">
      <div className="text-fg-muted font-medium">Recent receipts</div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {items.slice(0, 3).map((r) => (
          <li key={r.receipt_hash ?? r.tx_sig ?? Math.random()} className="font-mono">
            {r.receipt_hash ? (
              <Link href={receiptUrl(r.receipt_hash)} className="text-brand hover:underline">
                {shortHash(r.receipt_hash)}
              </Link>
            ) : null}
            {r.tx_sig ? (
              <>
                {' · '}
                <Link href={txUrl(r.tx_sig)} className="text-brand hover:underline">
                  tx {shortHash(r.tx_sig)}
                </Link>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
