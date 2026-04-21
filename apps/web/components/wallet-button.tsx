'use client';

import * as React from 'react';
import { LogOut, Wallet, Copy, Check } from 'lucide-react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PRIVY_APP_ID } from '@/lib/env';

function shorten(addr: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function WalletButton() {
  const [copied, setCopied] = React.useState(false);

  if (!PRIVY_APP_ID) {
    return (
      <Badge variant="warning" title="Set NEXT_PUBLIC_PRIVY_APP_ID to enable login">
        Privy not configured
      </Badge>
    );
  }

  return <ConfiguredWallet onCopy={() => setCopied(true)} copied={copied} setCopied={setCopied} />;
}

function ConfiguredWallet({
  onCopy,
  copied,
  setCopied,
}: {
  onCopy: () => void;
  copied: boolean;
  setCopied: (b: boolean) => void;
}) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const wallet = wallets[0];

  if (!ready) {
    return (
      <Button variant="ghost" size="sm" disabled>
        <Wallet className="opacity-60" />
        Loading…
      </Button>
    );
  }

  if (!authenticated) {
    return (
      <Button onClick={login} size="sm">
        <Wallet />
        Connect
      </Button>
    );
  }

  const address = wallet?.address ?? user?.wallet?.address ?? '';

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          if (!address) return;
          void navigator.clipboard.writeText(address);
          onCopy();
          setTimeout(() => setCopied(false), 1500);
        }}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-elev px-3 h-8 text-xs font-mono text-fg hover:border-border-strong transition-colors"
        title={address || 'no Solana wallet found'}
      >
        <span className="size-1.5 rounded-full bg-success" />
        {shorten(address) || 'no-wallet'}
        {copied ? (
          <Check className="size-3 text-success" />
        ) : (
          <Copy className="size-3 opacity-50" />
        )}
      </button>
      <Button variant="ghost" size="icon" onClick={logout} title="Log out">
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
