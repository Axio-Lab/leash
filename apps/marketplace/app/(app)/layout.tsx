'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
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
  const { ready, authenticated, user, logout } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && !authenticated) router.replace('/');
  }, [ready, authenticated, router]);
  if (!ready) {
    return (
      <div className="min-h-[60dvh] flex items-center justify-center text-fg-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!authenticated) return null;
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
