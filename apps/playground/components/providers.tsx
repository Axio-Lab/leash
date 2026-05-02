'use client';

import * as React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { PRIVY_APP_ID, getPrivyClientId, SOLANA_RPC } from '@/lib/env';
import { ToastProvider } from '@/components/ui/toast';
import { SidebarProvider } from '@/lib/sidebar-context';

/**
 * Wraps the app with Privy. If `NEXT_PUBLIC_PRIVY_APP_ID` is missing we
 * render children unwrapped so the rest of the playground still loads in
 * scaffolding mode (the wallet UI will show a "configure Privy" notice).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    return (
      <ToastProvider>
        <SidebarProvider>{children}</SidebarProvider>
      </ToastProvider>
    );
  }

  const clientId = getPrivyClientId();

  return (
    <ToastProvider>
      <SidebarProvider>
        <PrivyProvider
          appId={PRIVY_APP_ID}
          {...(clientId ? { clientId } : {})}
          config={{
            appearance: {
              theme: 'dark',
              accentColor: '#5e78f5',
              walletChainType: 'solana-only',
              showWalletLoginFirst: false,
              logo: 'https://avatars.githubusercontent.com/u/171483738?s=200&v=4',
            },
            loginMethods: ['email', 'wallet'],
            embeddedWallets: {
              solana: { createOnLogin: 'users-without-wallets' },
            },
            solanaClusters: [
              {
                name: 'devnet',
                rpcUrl: SOLANA_RPC,
              },
            ],
          }}
        >
          {children}
        </PrivyProvider>
      </SidebarProvider>
    </ToastProvider>
  );
}
