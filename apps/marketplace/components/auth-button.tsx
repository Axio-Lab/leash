'use client';

import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NEXT_PUBLIC_PRIVY_APP_ID } from '@/lib/env';

/**
 * Header auth widget for public marketing routes. The creator dashboard
 * has its own sign-in / sign-out chrome.
 */
export function AuthButton(): React.ReactElement | null {
  if (!NEXT_PUBLIC_PRIVY_APP_ID) return null;
  return <Inner />;
}

function Inner(): React.ReactElement {
  const { ready, authenticated, user, login, logout } = usePrivy();
  if (!ready) {
    return (
      <Badge variant="outline" className="text-xs">
        Loading…
      </Badge>
    );
  }
  if (!authenticated) {
    return (
      <Button onClick={login} size="sm">
        Sign in
      </Button>
    );
  }
  type Account = { type?: string; chainType?: string; address?: string };
  const accounts = (user?.linkedAccounts ?? []) as Account[];
  const solana = accounts.find((a) => a.type === 'wallet' && a.chainType === 'solana');
  const wallet = user?.wallet?.address ?? solana?.address ?? '';
  const short = wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : 'connected';
  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href="/creator">
          <span className="font-mono text-xs">{short}</span>
        </Link>
      </Button>
      <Button onClick={logout} size="icon" variant="ghost" aria-label="Sign out">
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
