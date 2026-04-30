'use client';

import Link from 'next/link';
import * as React from 'react';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';

import { receiptUrl, shortHash, txUrl } from '@/lib/explorer';

type ReceiptItem = {
  receipt_hash?: string;
  tx_sig?: string | null;
};

/**
 * Sidebar strip of the most recent inbound receipts for the active agent.
 *
 * Why the auth dance:
 * - The BFF route (`/api/receipts/[mint]`) verifies a Privy session. Privy's
 *   React SDK keeps the access token in storage, not a cookie, so a plain
 *   `credentials: 'include'` fetch 401s every time and SWR retries forever.
 * - We pull a fresh access token via `usePrivy().getAccessToken()` on every
 *   request and pause polling when we don't have one (logged out / loading).
 * - On 401 we back off to no polling, then resume once the user is signed in.
 */
export function InboundReceipts({ agentMint }: { agentMint: string | null }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [stopped, setStopped] = React.useState(false);

  const shouldFetch = ready && authenticated && Boolean(agentMint) && !stopped;

  const { data } = useSWR(
    shouldFetch ? `/api/receipts/${encodeURIComponent(agentMint!)}?limit=5` : null,
    async (url: string) => {
      const headers: Record<string, string> = {};
      try {
        const token = await getAccessToken();
        if (token) headers.authorization = `Bearer ${token}`;
      } catch {
        // No token yet — caller will retry once auth is ready.
      }
      const res = await fetch(url, { credentials: 'include', headers });
      if (res.status === 401) {
        setStopped(true);
        return { items: [] as ReceiptItem[] };
      }
      if (!res.ok) return { items: [] as ReceiptItem[] };
      return res.json() as Promise<{ items?: ReceiptItem[] }>;
    },
    {
      refreshInterval: shouldFetch ? 15_000 : 0,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  React.useEffect(() => {
    if (ready && authenticated) setStopped(false);
  }, [ready, authenticated, agentMint]);

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
