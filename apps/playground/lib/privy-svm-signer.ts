'use client';

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

/**
 * Bridge between Privy's wallet-adapter-style signer (which speaks
 * `@solana/web3.js` `VersionedTransaction`) and the `@solana/kit`
 * `TransactionPartialSigner` shape that `@x402/svm`'s `ExactSvmScheme`
 * needs to attach as the SPL transfer authority.
 *
 * Why we don't use Privy's address directly:
 *  - x402 builds a v0 transaction client-side, sets the facilitator as
 *    the fee payer, and calls `partiallySignTransactionMessageWithSigners`.
 *    That function walks every signer attached to the message and invokes
 *    `signTransactions(messages)`. Our adapter takes the kit-compiled
 *    `Transaction.messageBytes`, rebuilds it as a web3 `VersionedTransaction`,
 *    asks Privy to sign, then extracts our slot's 64-byte signature back
 *    out as the `SignatureDictionary` kit expects.
 */
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

        // Privy's SignerWalletAdapter signs in place and returns the same instance.
        const signed = (await wallet.signTransaction(
          vtx as unknown as VersionedTransaction,
        )) as VersionedTransaction;

        // Find our position in the static account keys; that index is the
        // index into `signed.signatures` we need to return.
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

/**
 * Convenience hook: returns a kit-shaped buyer signer backed by the
 * first connected Privy Solana wallet, or `null` until Privy is ready.
 */
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
