'use client';

import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { LogOutIcon } from 'lucide-react';

export function AppChrome({ children }: { children: React.ReactNode }) {
  const { user, logout } = usePrivy();
  type Account = { type?: string; chainType?: string; address?: string };
  const accounts = (user?.linkedAccounts ?? []) as Account[];
  const solanaWallet = accounts.find((a) => a.type === 'wallet' && a.chainType === 'solana');
  const wallet = user?.wallet?.address ?? solanaWallet?.address ?? '';

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="shrink-0 border-b border-border px-4 py-3 flex items-center justify-between bg-bg/80 backdrop-blur-md">
        <Link href="/agents" className="font-semibold tracking-tight text-base">
          leash · agents
        </Link>
        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <span className="font-mono truncate max-w-[20ch]">{wallet}</span>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-fg-muted hover:border-border-strong hover:text-fg"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOutIcon className="size-4" />
          </button>
        </div>
      </header>
      <main className="flex-1 px-5 py-6 mx-auto w-full max-w-[1200px]">{children}</main>
    </div>
  );
}
