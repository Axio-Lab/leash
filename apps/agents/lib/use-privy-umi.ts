'use client';

import * as React from 'react';
import { useSolanaWallets, type ConnectedSolanaWallet } from '@privy-io/react-auth/solana';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import type { Umi } from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplAgentIdentity, mplAgentTools } from '@metaplex-foundation/mpl-agent-registry';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { PublicKey } from '@solana/web3.js';

import { SOLANA_RPC } from './env';

/**
 * Browser Umi backed by the user's Privy wallet — same shape as
 * `apps/web/lib/privy-umi.ts`. Returns `null` while the wallet is
 * still connecting so callers can render a "connect" placeholder.
 */
export function usePrivyUmi(): {
  umi: Umi | null;
  wallet: ConnectedSolanaWallet | null;
  ready: boolean;
} {
  const { wallets, ready } = useSolanaWallets();
  const wallet = wallets[0] ?? null;
  const umi = React.useMemo<Umi | null>(() => {
    if (!wallet) return null;
    const adapter = {
      publicKey: new PublicKey(wallet.address),
      signMessage: wallet.signMessage.bind(wallet),
      signTransaction: wallet.signTransaction.bind(wallet),
      signAllTransactions: wallet.signAllTransactions.bind(wallet),
    };
    return createUmi(SOLANA_RPC)
      .use(mplCore())
      .use(mplToolbox())
      .use(mplAgentIdentity())
      .use(mplAgentTools())
      .use(walletAdapterIdentity(adapter));
  }, [wallet]);
  return { umi, wallet, ready };
}
