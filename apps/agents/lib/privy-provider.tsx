'use client';

import * as React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';

import { NEXT_PUBLIC_PRIVY_APP_ID, SOLANA_RPC, SOLANA_NETWORK } from './env';

/**
 * Wraps the app in `<PrivyProvider>` (Solana-only, embedded wallets).
 * If the public app id isn't set yet (early local dev), we render
 * children unwrapped so the rest of the app still loads — every
 * authed flow surfaces a "configure Privy" empty state.
 */
export function AgentsPrivyProvider({ children }: { children: React.ReactNode }) {
  if (!NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <div className="min-h-dvh">
        <NoPrivyBanner />
        {children}
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={NEXT_PUBLIC_PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#9b8cff',
          walletChainType: 'solana-only',
          showWalletLoginFirst: false,
        },
        loginMethods: ['email', 'wallet'],
        embeddedWallets: {
          solana: { createOnLogin: 'users-without-wallets' },
        },
        solanaClusters: [
          {
            name: SOLANA_NETWORK === 'solana-mainnet' ? 'mainnet-beta' : 'devnet',
            rpcUrl: SOLANA_RPC,
          },
        ],
      }}
    >
      {children}
    </PrivyProvider>
  );
}

function NoPrivyBanner() {
  return (
    <div className="px-3 py-2 text-xs text-amber-300 bg-amber-950/40 border-b border-amber-900/40 text-center">
      Configure <code>NEXT_PUBLIC_PRIVY_APP_ID</code> to enable login.
    </div>
  );
}
