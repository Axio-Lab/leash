'use client';

/**
 * Bridge between Privy's wallet-adapter-style signer (which speaks
 * `@solana/web3.js` `VersionedTransaction`) and the `@solana/kit`
 * `TransactionPartialSigner` shape that `@x402/svm`'s `ExactSvmScheme`
 * needs to attach as the SPL transfer authority.
 *
 * Mirrors `apps/web/lib/privy-svm-signer.ts`. Kept duplicated rather than
 * extracted into a shared package because the file is small, has no
 * server-only dependencies, and pulling it through a workspace package
 * would force every consumer to take a Privy peer dep just to import the
 * adapter.
 */

import * as React from 'react';
import { address as toAddress, type Address } from '@solana/kit';
import type {
  SignatureBytes,
  SignatureDictionary,
  Transaction as KitTransaction,
  TransactionPartialSigner,
} from '@solana/kit';
import { PublicKey, VersionedMessage, VersionedTransaction } from '@solana/web3.js';
import type { ConnectedSolanaWallet } from '@privy-io/react-auth/solana';
import { useSolanaWallets } from '@privy-io/react-auth/solana';

export function createPrivySvmSigner(wallet: ConnectedSolanaWallet): TransactionPartialSigner {
  const ownerPk = new PublicKey(wallet.address);
  const address = toAddress(wallet.address) as Address;

  return {
    address,
    async signTransactions(
      transactions: readonly KitTransaction[],
    ): Promise<readonly SignatureDictionary[]> {
      const out: SignatureDictionary[] = [];
      for (const tx of transactions) {
        const msg = VersionedMessage.deserialize(new Uint8Array(tx.messageBytes));
        const vtx = new VersionedTransaction(msg);
        const signed = (await wallet.signTransaction(
          vtx as unknown as VersionedTransaction,
        )) as VersionedTransaction;
        const keys = signed.message.staticAccountKeys;
        const idx = keys.findIndex((k) => k.equals(ownerPk));
        if (idx < 0) {
          throw new Error(`Privy signer ${wallet.address} not found in transaction signers`);
        }
        const sig = signed.signatures[idx];
        if (!sig || sig.length !== 64) {
          throw new Error(`Privy did not return a 64-byte signature at slot ${idx}`);
        }
        out.push({ [address]: sig as unknown as SignatureBytes });
      }
      return out;
    },
  };
}

export function usePrivySvmSigner(): {
  signer: TransactionPartialSigner | null;
  wallet: ConnectedSolanaWallet | null;
  ready: boolean;
} {
  const { wallets, ready } = useSolanaWallets();
  const wallet = wallets[0] ?? null;

  const signer = React.useMemo<TransactionPartialSigner | null>(() => {
    if (!wallet) return null;
    return createPrivySvmSigner(wallet);
  }, [wallet]);

  return { signer, wallet, ready };
}
