import { findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import type { Context, PublicKey } from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';

export type AgentSellerConfig = {
  asset: string | PublicKey;
};

export function resolveSellerPayTo(
  umi: Pick<Context, 'eddsa' | 'programs'>,
  cfg: AgentSellerConfig,
): string {
  const asset = typeof cfg.asset === 'string' ? publicKey(cfg.asset) : cfg.asset;
  const [addr] = findAssetSignerPda(umi, { asset });
  return String(addr);
}
