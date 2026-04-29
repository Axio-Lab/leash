'use client';

import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';

import { NEXT_PUBLIC_PRIVY_APP_ID } from '@/lib/env';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  if (!NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <div className="min-h-[60dvh] flex items-center justify-center text-sm text-fg-muted px-6 text-center">
        Configure <code className="mx-1 text-brand">NEXT_PUBLIC_PRIVY_APP_ID</code> to enable login.
      </div>
    );
  }
  return <Inner>{children}</Inner>;
}

function Inner({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  if (!ready) {
    return (
      <div className="min-h-[60dvh] flex items-center justify-center text-fg-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!authenticated) {
    // Don't bounce off the page — render an in-place sign-in prompt so
    // users keep their intent (e.g. /dev/list) and land back on the
    // exact route after Privy closes its modal.
    return (
      <div className="min-h-[60dvh] flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-xl border bg-bg-elev p-8 text-center space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Sign in to continue</h2>
          <p className="text-sm text-fg-muted">
            You need a leash account to manage listings, reviews, and API keys. Email or Solana
            wallet — your call.
          </p>
          <button
            type="button"
            onClick={login}
            className="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-strong"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }
  type Account = { type?: string; chainType?: string; address?: string };
  const accounts = (user?.linkedAccounts ?? []) as Account[];
  const solanaWallet = accounts.find((a) => a.type === 'wallet' && a.chainType === 'solana');
  const wallet = user?.wallet?.address ?? solanaWallet?.address ?? '';
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <nav className="flex items-center gap-4 text-sm text-fg-muted">
          <Link href="/dev" className="hover:text-fg">
            Overview
          </Link>
          <Link href="/dev/listings" className="hover:text-fg">
            My listings
          </Link>
          <Link href="/dev/list" className="hover:text-fg">
            List a tool
          </Link>
          <Link href="/settings/api-keys" className="hover:text-fg">
            API keys
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <span className="font-mono truncate max-w-[20ch]">{wallet}</span>
          <button
            type="button"
            onClick={logout}
            className="rounded-md border px-2 py-1 hover:border-border-strong"
          >
            Sign out
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
