import type { PublicKey } from '@metaplex-foundation/umi';

/**
 * v0.1 stub: full MPL Core `Execute` + SPL transfer composition ships in a follow-up PR.
 * Callers should use Umi + mpl-core instructions; this export reserves the API surface.
 */
export type WithdrawParams = {
  asset: PublicKey;
  mint: PublicKey;
  amount: bigint;
  destination: PublicKey;
};

export function describeWithdraw(_p: WithdrawParams): string {
  return 'withdraw: use Umi mpl-core Execute with SPL transferChecked from Asset Signer PDA';
}
