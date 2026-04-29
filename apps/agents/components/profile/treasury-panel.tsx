'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { publicKey } from '@metaplex-foundation/umi';
import { ArrowDownToLineIcon, ExternalLinkIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { withdrawTreasury, withdrawTreasurySol } from '@leash/registry-utils';
import { TOKEN_2022_PROGRAM_ID, lookupToken } from '@leash/core';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SOLANA_NETWORK } from '@/lib/env';
import { usePrivyUmi } from '@/lib/use-privy-umi';

type Balance = {
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
  amount: string;
  ui: number;
  program: 'spl-token' | 'spl-token-2022';
  known: boolean;
};

type BalancesResponse = {
  treasury: string;
  owner: string;
  network: 'mainnet' | 'devnet';
  sol: number;
  lamports: string;
  tokens: Balance[];
};

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as BalancesResponse;
};

const PRIORITY_SYMBOLS = ['USDC', 'USDG', 'USDT'];

function explorerAddr(addr: string, network: string): string {
  const cluster = network === 'solana-mainnet' ? '' : '?cluster=devnet';
  return `https://solscan.io/account/${addr}${cluster}`;
}

function fmtAmount(n: number): string {
  if (n === 0) return '0';
  if (n < 0.0001) return n.toExponential(2);
  if (n >= 10_000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function TreasuryPanel({
  agentMint,
  ownerWallet,
}: {
  agentMint: string;
  ownerWallet: string;
}) {
  const { data, error, isLoading, mutate, isValidating } = useSWR<BalancesResponse>(
    `/api/agents/${encodeURIComponent(agentMint)}/balances`,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false },
  );
  const [withdrawing, setWithdrawing] = React.useState<Balance | 'sol' | null>(null);

  // Sort: pinned stables first (USDC/USDG/USDT), then everything else by ui desc
  const sortedTokens = React.useMemo(() => {
    if (!data) return [] as Balance[];
    return [...data.tokens].sort((a, b) => {
      const ai = PRIORITY_SYMBOLS.indexOf(a.symbol ?? '');
      const bi = PRIORITY_SYMBOLS.indexOf(b.symbol ?? '');
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return b.ui - a.ui;
    });
  }, [data]);

  return (
    <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Treasury balance</h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Live from Solana RPC. Refreshes every 30 s.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void mutate()}
          disabled={isValidating}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg disabled:opacity-50"
        >
          <RefreshCwIcon className={`size-3.5 ${isValidating ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-warning/40 bg-warning/8 p-3 text-xs text-warning">
          Could not read balances: {(error as Error).message}
        </div>
      ) : null}

      {isLoading && !data ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted py-6 justify-center">
          <Spinner size="sm" /> Loading balances
        </div>
      ) : data ? (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {/* SOL row */}
          <BalanceRow
            symbol="SOL"
            name="Solana"
            amount={data.sol}
            program="native"
            onWithdraw={() => setWithdrawing('sol')}
            disabledWithdraw={data.sol <= 0}
          />
          {sortedTokens.map((t) => (
            <BalanceRow
              key={t.mint}
              symbol={t.symbol ?? `${t.mint.slice(0, 4)}…`}
              name={t.name ?? 'Unknown token'}
              amount={t.ui}
              program={t.program}
              onWithdraw={() => setWithdrawing(t)}
              disabledWithdraw={t.ui <= 0}
            />
          ))}
        </ul>
      ) : null}

      {data?.treasury ? (
        <a
          href={explorerAddr(data.treasury, SOLANA_NETWORK)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg font-mono"
        >
          treasury · {data.treasury.slice(0, 6)}…{data.treasury.slice(-6)}
          <ExternalLinkIcon className="size-3" />
        </a>
      ) : null}

      {withdrawing ? (
        <WithdrawModal
          agentMint={agentMint}
          ownerWallet={ownerWallet}
          target={withdrawing}
          onClose={() => setWithdrawing(null)}
          onDone={() => {
            setWithdrawing(null);
            void mutate();
          }}
        />
      ) : null}
    </section>
  );
}

function BalanceRow({
  symbol,
  name,
  amount,
  program,
  onWithdraw,
  disabledWithdraw,
}: {
  symbol: string;
  name: string;
  amount: number;
  program: 'spl-token' | 'spl-token-2022' | 'native';
  onWithdraw: () => void;
  disabledWithdraw: boolean;
}) {
  return (
    <li className="rounded-lg border border-border/60 bg-bg/40 p-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{symbol}</span>
          {program === 'spl-token-2022' ? (
            <span className="text-[9px] uppercase tracking-widest text-fg-subtle font-mono">
              T-2022
            </span>
          ) : null}
        </div>
        <div className="text-[11px] text-fg-subtle truncate">{name}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-sm">{fmtAmount(amount)}</span>
        <button
          type="button"
          onClick={onWithdraw}
          disabled={disabledWithdraw}
          className="rounded-md border border-border p-1.5 text-fg-subtle hover:border-brand/40 hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
          title="Withdraw"
          aria-label={`Withdraw ${symbol}`}
        >
          <ArrowDownToLineIcon className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function WithdrawModal({
  agentMint,
  ownerWallet,
  target,
  onClose,
  onDone,
}: {
  agentMint: string;
  ownerWallet: string;
  target: Balance | 'sol';
  onClose: () => void;
  onDone: () => void;
}) {
  const { umi, ready } = usePrivyUmi();
  const isSol = target === 'sol';
  const meta = isSol
    ? { symbol: 'SOL', decimals: 9, mint: null as string | null }
    : { symbol: target.symbol ?? 'TOKEN', decimals: target.decimals, mint: target.mint };

  const [amount, setAmount] = React.useState('');
  const [destMode, setDestMode] = React.useState<'owner' | 'custom'>('owner');
  const [customDest, setCustomDest] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  async function submit() {
    const decimal = Number(amount);
    if (!Number.isFinite(decimal) || decimal <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    const dest = destMode === 'owner' ? ownerWallet : customDest.trim();
    if (!dest) {
      toast.error('Destination address required');
      return;
    }
    if (!umi || !ready) {
      toast.error('Wallet not ready');
      return;
    }
    setBusy(true);
    try {
      if (isSol) {
        const lamports = BigInt(Math.floor(decimal * 1_000_000_000));
        const res = await withdrawTreasurySol(umi, {
          agentAsset: agentMint,
          destination: dest,
          lamports,
        });
        toast.success('Withdraw confirmed', { description: `tx ${res.signature.slice(0, 8)}…` });
      } else {
        const atomic = BigInt(Math.floor(decimal * 10 ** meta.decimals));
        const tokenNetwork = SOLANA_NETWORK === 'solana-mainnet' ? 'mainnet' : 'devnet';
        const tokenInfo = lookupToken(meta.mint!, tokenNetwork);
        const tokenProgram =
          (target as Balance).program === 'spl-token-2022' ||
          tokenInfo?.program === 'spl-token-2022'
            ? publicKey(TOKEN_2022_PROGRAM_ID)
            : undefined;
        const res = await withdrawTreasury(umi, {
          agentAsset: agentMint,
          mint: meta.mint!,
          destination: dest,
          amount: atomic,
          decimals: meta.decimals,
          ...(tokenProgram ? { tokenProgram } : {}),
        });
        toast.success('Withdraw confirmed', { description: `tx ${res.signature.slice(0, 8)}…` });
      }
      onDone();
    } catch (e) {
      toast.error('Withdraw failed', {
        description: e instanceof Error ? e.message : 'unknown',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-bg-elev shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Withdraw {meta.symbol}</h2>
            <p className="text-xs text-fg-muted mt-0.5">
              Funds leave the treasury and arrive in the destination wallet&apos;s ATA.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-border p-1.5 text-fg-muted hover:border-border-strong hover:text-fg"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <label className="block text-sm">
            <span className="text-fg-muted text-[11px] uppercase tracking-widest">Amount</span>
            <div className="mt-1.5 relative">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0.00"
                className="w-full rounded-lg border border-border bg-bg pl-3 pr-16 py-2.5 text-sm font-mono focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle font-mono">
                {meta.symbol}
              </span>
            </div>
          </label>

          <div className="space-y-2">
            <span className="text-fg-muted text-[11px] uppercase tracking-widest">Destination</span>
            <div className="flex flex-wrap gap-1.5 border border-border rounded-lg p-1 bg-bg/40 w-fit">
              <DestTab active={destMode === 'owner'} onClick={() => setDestMode('owner')}>
                Owner wallet
              </DestTab>
              <DestTab active={destMode === 'custom'} onClick={() => setDestMode('custom')}>
                Custom address
              </DestTab>
            </div>
            {destMode === 'owner' ? (
              <div className="rounded-lg border border-border/60 bg-bg/40 px-3 py-2 text-xs font-mono text-fg-muted">
                {ownerWallet || 'Not connected'}
              </div>
            ) : (
              <input
                value={customDest}
                onChange={(e) => setCustomDest(e.target.value.trim())}
                placeholder="Recipient Solana address…"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm font-mono focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border p-3 sm:p-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !amount || (!ownerWallet && destMode === 'owner')}
          >
            {busy ? <Spinner size="sm" /> : null}
            Withdraw
          </Button>
        </div>
      </div>
    </div>
  );
}

function DestTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-bg-elev text-fg shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.4)]'
          : 'text-fg-muted hover:text-fg hover:bg-bg-elev/60'
      }`}
    >
      {children}
    </button>
  );
}
