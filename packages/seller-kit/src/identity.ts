export type SellerIdentityMetadata = {
  agent_mint: string;
  handle?: string;
  domain?: string;
  capabilities?: string[];
};

export function buildSellerIdentityMetadata(input: SellerIdentityMetadata): {
  leash: { identity: SellerIdentityMetadata };
} {
  return { leash: { identity: input } };
}
