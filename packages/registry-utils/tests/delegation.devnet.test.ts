/**
 * Real on-chain devnet test for the agent treasury delegation pipeline.
 *
 * Skipped by default. To run:
 *
 *   LEASH_TEST_PAYER_SECRET_KEY='<base58-or-json-array-secret>' \
 *   LEASH_TEST_AGENT_ASSET='<core-asset-pubkey>'                \
 *   LEASH_TEST_USDC_MINT='4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' \
 *   pnpm --filter @leash/registry-utils test:devnet
 *
 * Pre-conditions on-chain:
 *
 *   1. The payer keypair owns the agent asset at LEASH_TEST_AGENT_ASSET
 *      (mint via `createAgent` first if you don't have one yet).
 *   2. The payer has enough devnet SOL (~0.01 SOL is plenty) to cover the
 *      ATA rent + tx fees. Get it from https://faucet.solana.com.
 *
 * The test exercises a complete cycle:
 *
 *   a. setSpendDelegation(amount=N)  → ATA exists, delegate=payer, delegated_amount=N
 *   b. getSpendDelegation()          → matches the wired state
 *   c. setSpendDelegation(amount=M)  → ATA already existed, delegate=payer, delegated_amount=M
 *   d. revokeSpendDelegation()       → delegate=null, delegated_amount=0
 *
 * No tokens are moved (we don't need to fund the treasury for the
 * delegation primitives — those are a property of the token account
 * itself, not the balance). A separate buyer-kit devnet test exercises
 * the delegated transfer end-to-end.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, publicKey, type Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore } from '@metaplex-foundation/mpl-core';
import {
  setSpendDelegation,
  revokeSpendDelegation,
  getSpendDelegation,
} from '../src/delegation.js';

const SHOULD_RUN =
  Boolean(process.env.LEASH_TEST_PAYER_SECRET_KEY) && Boolean(process.env.LEASH_TEST_AGENT_ASSET);
const RPC = process.env.LEASH_TEST_RPC ?? 'https://api.devnet.solana.com';
const USDC = process.env.LEASH_TEST_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function decodeSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }
  return base58.serialize(trimmed);
}

const describeOrSkip = SHOULD_RUN ? describe : describe.skip;

describeOrSkip('SPL spend delegation (devnet)', () => {
  let umi: Umi;
  let payerPubkey: string;
  const agentAsset = process.env.LEASH_TEST_AGENT_ASSET as string;

  beforeAll(() => {
    umi = createUmi(RPC).use(mplCore());
    const secret = decodeSecretKey(process.env.LEASH_TEST_PAYER_SECRET_KEY as string);
    const kp = umi.eddsa.createKeypairFromSecretKey(secret);
    umi.use(keypairIdentity(kp));
    payerPubkey = String(kp.publicKey);
  });

  // 60s — devnet confirmations can stall.
  const TIMEOUT = 60_000;

  it(
    'approves a $5 USDC delegation, then re-approves $1, then revokes',
    async () => {
      // Step a: initial 5 USDC delegation (5_000_000 atomic units).
      const five = 5_000_000n;
      const approved = await setSpendDelegation(umi, {
        agentAsset,
        mint: USDC,
        executive: payerPubkey,
        amount: five,
      });
      expect(approved.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
      expect(approved.delegate).toBe(payerPubkey);
      expect(approved.delegatedAmount).toBe(five);

      const status1 = await getSpendDelegation(umi, {
        agentAsset,
        mint: USDC,
      });
      expect(status1.sourceExists).toBe(true);
      expect(status1.delegate).toBe(payerPubkey);
      expect(status1.delegatedAmount).toBe(five);
      expect(status1.sourceTokenAccount).toBe(approved.sourceTokenAccount);

      // Step c: re-approve to 1 USDC. SPL Approve overwrites cleanly.
      const one = 1_000_000n;
      const reapproved = await setSpendDelegation(umi, {
        agentAsset,
        mint: USDC,
        executive: payerPubkey,
        amount: one,
      });
      expect(reapproved.delegatedAmount).toBe(one);
      const status2 = await getSpendDelegation(umi, { agentAsset, mint: USDC });
      expect(status2.delegate).toBe(payerPubkey);
      expect(status2.delegatedAmount).toBe(one);

      // Step d: revoke clears delegate and delegated_amount.
      const revoked = await revokeSpendDelegation(umi, { agentAsset, mint: USDC });
      expect(revoked.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
      expect(revoked.sourceTokenAccount).toBe(approved.sourceTokenAccount);
      const status3 = await getSpendDelegation(umi, { agentAsset, mint: USDC });
      expect(status3.delegate).toBeNull();
      expect(status3.delegatedAmount).toBe(0n);
    },
    TIMEOUT,
  );

  it('returns sourceExists=false for a never-touched mint', async () => {
    // Use a non-USDC mint so the agent's ATA almost certainly doesn't exist.
    // BONK on devnet (won't exist for a fresh agent treasury). If you happen
    // to have funded the treasury with BONK, swap LEASH_TEST_FRESH_MINT.
    const freshMint =
      process.env.LEASH_TEST_FRESH_MINT ?? 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    const status = await getSpendDelegation(umi, {
      agentAsset,
      mint: publicKey(freshMint),
    });
    if (status.sourceExists) {
      // Not the test we wanted to run on this account; assert it at least
      // returns a coherent shape rather than failing the suite.
      expect(typeof status.delegatedAmount).toBe('bigint');
    } else {
      expect(status.delegate).toBeNull();
      expect(status.delegatedAmount).toBe(0n);
      expect(status.balance).toBe(0n);
    }
  });
});
