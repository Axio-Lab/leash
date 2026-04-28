'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { NEXT_PUBLIC_PRIVY_APP_ID } from '@/lib/env';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  if (!NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-sm text-fg-muted px-6 text-center">
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
  if (!ready) return <FullPageSpinner />;
  if (!authenticated) return null;
  // Privy's `LinkedAccountWithMetadata` is a union of every account
  // type. We only care about the Solana wallet entry; runtime narrowing
  // without TS asserts keeps the compiler happy across SDK upgrades.
  type Account = { type?: string; chainType?: string; address?: string };
  const accounts = (user?.linkedAccounts ?? []) as Account[];
  const solanaWallet = accounts.find((a) => a.type === 'wallet' && a.chainType === 'solana');
  const wallet = user?.wallet?.address ?? solanaWallet?.address ?? '';
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="border-b px-5 py-3 flex items-center gap-6">
        <Link href="/dashboard" className="font-semibold tracking-tight text-base">
          leash · agents
        </Link>
        <nav className="flex items-center gap-4 text-sm text-fg-muted">
          <Link href="/dashboard" className="hover:text-fg">
            Dashboard
          </Link>
          <Link href="/agents" className="hover:text-fg">
            Agents
          </Link>
          <Link href="/settings/api-keys" className="hover:text-fg">
            API keys
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs text-fg-muted">
          <span className="font-mono truncate max-w-[20ch]">{wallet}</span>
          <button
            type="button"
            onClick={logout}
            className="rounded-md border px-2 py-1 hover:border-border-strong"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1 px-5 py-6 mx-auto w-full max-w-[1200px]">{children}</main>
    </div>
  );
}

function FullPageSpinner() {
  return (
    <div className="min-h-dvh flex items-center justify-center text-fg-muted text-sm">Loading…</div>
  );
}
