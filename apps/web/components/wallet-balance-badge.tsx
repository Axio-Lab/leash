'use client';

import * as React from 'react';
import useSWR from 'swr';
import { Wallet, ExternalLink, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { jsonFetcher } from '@/lib/fetcher';

type TokenBalance = {
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
  amount: string;
  ui: number;
  known: boolean;
};

type BalanceResponse = {
  owner: string;
  network: 'mainnet' | 'devnet';
  sol: number;
  tokens: TokenBalance[];
};

/**
 * Compact balance pill we render at the top of the buyer playground so
 * developers can see at a glance whether their connected Privy wallet has
 * enough USDC + SOL to fund the next x402 spend on devnet. Polls every 8s.
 */
export function WalletBalanceBadge({
  owner,
  label = 'Wallet',
}: {
  owner?: string;
  label?: string;
}) {
  const { data, isLoading, mutate, error } = useSWR<BalanceResponse>(
    owner ? `/api/wallet/balance?owner=${owner}` : null,
    jsonFetcher,
    { refreshInterval: 8000 },
  );

  if (!owner) return null;

  const usdc = data?.tokens.find((t) => t.symbol === 'USDC');
  const sol = data?.sol ?? 0;
  const network = data?.network ?? 'devnet';
  const isDevnet = network === 'devnet';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Wallet className="size-3.5 text-fg-muted" />
      <span className="text-fg-muted">{label}:</span>
      {error ? (
        <span className="text-danger">balance error</span>
      ) : isLoading && !data ? (
        <span className="text-fg-muted">loading…</span>
      ) : (
        <>
          <Badge variant={usdc && usdc.ui > 0 ? 'success' : 'warning'} className="font-mono">
            {usdc ? `${usdc.ui.toFixed(usdc.decimals === 6 ? 4 : 2)} USDC` : 'no USDC ATA'}
          </Badge>
          <Badge variant={sol > 0.005 ? 'default' : 'warning'} className="font-mono">
            {sol.toFixed(4)} SOL
          </Badge>
        </>
      )}
      <button
        type="button"
        aria-label="refresh"
        onClick={() => mutate()}
        className="ml-1 rounded p-1 text-fg-subtle hover:text-fg hover:bg-bg-elev"
      >
        <RefreshCw className="size-3" />
      </button>
      {isDevnet && (!usdc || usdc.ui === 0) && (
        <a
          href="https://faucet.circle.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand hover:underline"
        >
          Get devnet USDC <ExternalLink className="size-3" />
        </a>
      )}
      {isDevnet && sol < 0.005 && (
        <a
          href="https://faucet.solana.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand hover:underline"
        >
          Get devnet SOL <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}
