'use client';

import * as React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';

import { NEXT_PUBLIC_PRIVY_APP_ID } from './env';

export function MarketplacePrivyProvider({ children }: { children: React.ReactNode }) {
  if (!NEXT_PUBLIC_PRIVY_APP_ID) return <>{children}</>;
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
      }}
    >
      {children}
    </PrivyProvider>
  );
}
