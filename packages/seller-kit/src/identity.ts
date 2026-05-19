export type SellerIdentityMetadata = {
  agent_mint: string;
  handle?: string;
  domain?: string;
  capabilities?: string[];
  capability_cards?: Array<{
    kind?: string;
    slug?: string;
    endpoint?: string;
    protocol?: 'x402' | 'mpp';
  }>;
  claims?: string[];
};

export function buildSellerIdentityMetadata(input: SellerIdentityMetadata): {
  leash: { identity: SellerIdentityMetadata & { v: '0.1' } };
} {
  return { leash: { identity: { v: '0.1', ...input } } };
}
