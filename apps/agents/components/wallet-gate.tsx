'use client';

import * as React from 'react';
import { Sparkles, Wallet } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth/solana';

/**
 * Blocks chat until the user has a Solana wallet (embedded or linked).
 */
export function WalletGate({ children }: { children: React.ReactNode }) {
  const { user, linkWallet } = usePrivy();
  const { wallets, createWallet, ready } = useSolanaWallets();
  const [busy, setBusy] = React.useState<'embedded' | 'external' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const hasSolana = React.useMemo(() => {
    if (wallets.length > 0) return true;
    type Account = { type?: string; chainType?: string; address?: string };
    const accounts = (user?.linkedAccounts ?? []) as Account[];
    if (accounts.some((a) => a.type === 'wallet' && a.chainType === 'solana' && a.address)) {
      return true;
    }
    if (user?.wallet?.chainType === 'solana' && user.wallet.address) return true;
    return false;
  }, [user, wallets]);

  if (hasSolana) return <>{children}</>;

  async function onCreateEmbedded() {
    setError(null);
    setBusy('embedded');
    try {
      await createWallet();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not create an embedded Solana wallet. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function onLinkExternal() {
    setError(null);
    setBusy('external');
    try {
      await linkWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wallet link cancelled.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-[60vh] grid place-items-center px-6 py-12">
      <div className="w-full max-w-lg rounded-xl border border-border bg-bg-elev p-8 space-y-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-fg-muted">
            <Wallet className="size-3" /> One more step
          </span>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Connect a Solana wallet</h2>
          <p className="mt-2 text-sm text-fg-muted">
            Leash agents settle on Solana. Attach an embedded wallet or link Phantom / Solflare /
            Backpack.
          </p>
        </div>
        <div className="space-y-3">
          <button
            type="button"
            className="w-full flex items-center justify-between rounded-lg bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            onClick={onCreateEmbedded}
            disabled={!ready || busy !== null}
          >
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" /> Create embedded Solana wallet
            </span>
            <span className="text-xs text-white/80">
              {busy === 'embedded' ? 'Creating…' : 'Recommended'}
            </span>
          </button>
          <button
            type="button"
            className="w-full flex items-center justify-between rounded-lg border border-border bg-bg px-4 py-3 text-sm font-medium hover:border-border-strong disabled:opacity-60"
            onClick={onLinkExternal}
            disabled={busy !== null}
          >
            <span className="flex items-center gap-2">
              <Wallet className="size-4" /> Connect external wallet
            </span>
            <span className="text-xs text-fg-muted">
              {busy === 'external' ? 'Opening…' : 'Phantom, Solflare…'}
            </span>
          </button>
        </div>
        {error ? <div className="text-xs text-danger">{error}</div> : null}
        <p className="text-xs text-fg-subtle">
          Your wallet only signs on-chain actions. Leash never sees a private key.
        </p>
      </div>
    </div>
  );
}
