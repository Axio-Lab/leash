'use client';

import { usePrivy } from '@privy-io/react-auth';

import { NEXT_PUBLIC_PRIVY_APP_ID } from '@/lib/env';

/**
 * Header auth widget. Renders nothing if Privy is not configured (so
 * local dev without a Privy app id still loads); otherwise:
 *   - logged out: "Sign in" — triggers the Privy modal
 *   - logged in:  short wallet pill + "Sign out"
 *
 * Mounted in the root layout so EVERY route (incl. `/`, `/browse`,
 * `/dev`, `/admin`) has a single, consistent way to authenticate.
 */
export function AuthButton(): React.ReactElement | null {
  if (!NEXT_PUBLIC_PRIVY_APP_ID) return null;
  return <Inner />;
}

function Inner(): React.ReactElement {
  const { ready, authenticated, user, login, logout } = usePrivy();
  if (!ready) {
    return <span className="rounded-md border px-3 py-1.5 text-xs text-fg-muted">Loading…</span>;
  }
  if (!authenticated) {
    return (
      <button
        type="button"
        onClick={login}
        className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-strong"
      >
        Sign in
      </button>
    );
  }
  type Account = { type?: string; chainType?: string; address?: string };
  const accounts = (user?.linkedAccounts ?? []) as Account[];
  const solana = accounts.find((a) => a.type === 'wallet' && a.chainType === 'solana');
  const wallet = user?.wallet?.address ?? solana?.address ?? '';
  const short = wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : 'connected';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="rounded-md border px-2 py-1 font-mono text-fg-muted">{short}</span>
      <button
        type="button"
        onClick={logout}
        className="rounded-md border px-2 py-1 text-fg-muted hover:border-border-strong hover:text-fg"
      >
        Sign out
      </button>
    </div>
  );
}
