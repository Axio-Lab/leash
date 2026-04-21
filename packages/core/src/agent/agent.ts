import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import type { Context, PublicKey } from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';

export class Agent {
  readonly asset: PublicKey;

  constructor(asset: string | PublicKey) {
    this.asset = typeof asset === 'string' ? publicKey(asset) : asset;
  }

  /** Asset Signer PDA (treasury) — requires Umi context for PDA derivation. */
  treasuryPda(umi: Pick<Context, 'eddsa' | 'programs'>): PublicKey {
    const [address] = findAssetSignerPda(umi, { asset: this.asset });
    return address;
  }
}
