import type { SellerIdentityMetadata, SellerIdentityMetadataEnvelope } from '@leashmarket/schemas';

export type { SellerIdentityMetadata, SellerIdentityMetadataEnvelope } from '@leashmarket/schemas';

export function buildSellerIdentityMetadata(
  input: SellerIdentityMetadata,
): SellerIdentityMetadataEnvelope {
  return { leash: { identity: { v: '0.1', ...input } } };
}
