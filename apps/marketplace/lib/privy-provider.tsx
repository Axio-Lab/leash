'use client';

import * as React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

import { NEXT_PUBLIC_PRIVY_APP_ID, SOLANA_NETWORK, SOLANA_RPC } from './env';

const solanaConnectors = toSolanaWalletConnectors();

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
        externalWallets: {
          solana: { connectors: solanaConnectors },
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
