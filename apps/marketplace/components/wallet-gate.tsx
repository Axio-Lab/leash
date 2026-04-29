'use client';

import * as React from 'react';
import { Sparkles, Wallet } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth/solana';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Some authenticated Privy users don't have a Solana wallet yet — e.g.
 * they signed in with email before `embeddedWallets.solana.createOnLogin`
 * was configured, or their session is replayed against a Privy app where
 * the embedded Solana wallet provisioning failed.
 *
 * Without a Solana wallet, every authenticated BFF returns 409
 * `no_solana_wallet`, so the dashboard would appear to be permanently
 * broken. This gate detects that state and offers two recoveries:
 *
 *   1. **Create embedded Solana wallet** — uses Privy's
 *      `useSolanaWallets().createWallet()`. Best UX for email signups.
 *   2. **Connect external wallet** — opens Privy's link-wallet flow
 *      (`linkWallet`), which honours the `solana-only` chain config.
 *
 * Once the user picks one and the linked account list updates, this
 * component renders `children` and the rest of the dashboard works.
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
      <div className="w-full max-w-lg rounded-xl border bg-aurora p-8 space-y-5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono uppercase tracking-widest">
            <Wallet className="size-3 mr-1.5" /> One more step
          </Badge>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Connect a Solana wallet</h2>
          <p className="mt-2 text-sm text-fg-muted">
            Leash settles every paid execution on Solana, so each creator account needs a Solana
            wallet attached. Pick the option that fits — you can change it later.
          </p>
        </div>
        <div className="space-y-3">
          <Button
            type="button"
            size="lg"
            className="w-full justify-between"
            onClick={onCreateEmbedded}
            disabled={!ready || busy !== null}
          >
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" /> Create embedded Solana wallet
            </span>
            <span className="text-xs text-white/80">
              {busy === 'embedded' ? 'Creating…' : 'Recommended'}
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full justify-between"
            onClick={onLinkExternal}
            disabled={busy !== null}
          >
            <span className="flex items-center gap-2">
              <Wallet className="size-4" /> Connect external wallet
            </span>
            <span className="text-xs text-fg-muted">
              {busy === 'external' ? 'Opening…' : 'Phantom, Solflare, Backpack…'}
            </span>
          </Button>
        </div>
        {error ? <div className="text-xs text-danger">{error}</div> : null}
        <p className="text-xs text-fg-subtle">
          Your wallet only ever signs payment + receipt transactions. Leash never sees a private
          key.
        </p>
      </div>
    </div>
  );
}
