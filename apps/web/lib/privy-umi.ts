'use client';

import * as React from 'react';
import { useSolanaWallets, type ConnectedSolanaWallet } from '@privy-io/react-auth/solana';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import type { Umi } from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplAgentIdentity, mplAgentTools } from '@metaplex-foundation/mpl-agent-registry';
import { PublicKey } from '@solana/web3.js';
import { SOLANA_RPC } from './env';

/**
 * Browser-side Umi instance backed by the user's connected Privy wallet.
 *
 * Privy's `ConnectedSolanaWallet` already implements the
 * `solana/wallet-adapter` `SignerWalletAdapter` shape (`signMessage`,
 * `signTransaction`, `signAllTransactions`), so we wrap it directly via
 * Metaplex's `walletAdapterIdentity` plugin. The wallet's `address` becomes
 * `umi.identity.publicKey` and pays for / signs every Umi transaction.
 *
 * Returns `null` when the user is not connected yet so callers can render a
 * "connect wallet" empty state instead of a half-built Umi.
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
      .use(mplAgentIdentity())
      .use(mplAgentTools())
      .use(walletAdapterIdentity(adapter));
  }, [wallet]);

  return { umi, wallet, ready };
}
