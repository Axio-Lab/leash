'use client';

import { provisionTreasuryAtas, setSpendDelegation } from '@leash/registry-utils';
import { publicKey } from '@metaplex-foundation/umi';
import type { Umi } from '@metaplex-foundation/umi';

import { SOLANA_NETWORK, type SolanaNetwork } from './env';

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function usdcMint(network: SolanaNetwork): string {
  return network === 'solana-mainnet' ? MAINNET_USDC : DEVNET_USDC;
}

/** Default spend delegation: 100 USDC (6 decimals). */
const DEFAULT_DELEGATION_ATOMIC = 100_000_000n;

/**
 * After mint: provision stablecoin ATAs on the treasury + approve executive spend cap.
 */
export async function provisionTreasuryAndDelegate(args: {
  umi: Umi;
  agentMint: string;
  executiveWallet: string;
  network?: SolanaNetwork;
  onProgress?: (msg: string) => void;
}): Promise<void> {
  const net = args.network ?? SOLANA_NETWORK;
  const mintPk = publicKey(usdcMint(net));
  args.onProgress?.('Provisioning treasury token accounts…');
  await provisionTreasuryAtas(args.umi, {
    agentAsset: args.agentMint,
    network: net,
  });
  args.onProgress?.('Setting spend delegation for USDC…');
  await setSpendDelegation(args.umi, {
    agentAsset: args.agentMint,
    mint: mintPk,
    executive: args.executiveWallet,
    amount: DEFAULT_DELEGATION_ATOMIC,
  });
}
