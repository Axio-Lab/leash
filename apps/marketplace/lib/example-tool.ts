import type { ListingDraft, ManifestImport } from './listing-helper';

/**
 * Demo manifest used by the "Try an example" button on the list-a-tool
 * flow. Matches the seeded `premium-search` listing so creators can see
 * a real, valid shape before wiring up their own endpoint.
 */
export const EXAMPLE_MANIFEST: ManifestImport = {
  name: 'Premium Web Search',
  slug: 'my-premium-search',
  description: 'Search 50M curated sources with citations. Built for agents that need fresh facts.',
  category: 'search',
  endpoint: 'https://search.demo.leash.market/mcp',
  endpoints: [
    {
      method: 'POST',
      url: 'https://search.demo.leash.market/mcp/tools/search',
      description: 'Returns the top results for a query, with citations.',
      pricing: { type: 'per_call', amount: '0.001', currency: 'USDC' },
      protocol: ['x402'],
      supported_usd: ['USDC', 'USDT', 'USDG'],
    },
    {
      method: 'GET',
      url: 'https://search.demo.leash.market/mcp/tools/fetch_url',
      description: 'Fetch a single URL and return cleaned markdown.',
      pricing: { type: 'variable' },
      protocol: ['x402'],
      supported_usd: ['USDC'],
    },
  ],
  pricing: { type: 'per_call', amount: '0.001', currency: 'USDC' },
  docs_url: 'https://docs.demo.leash.market/search',
  free_tier: 100,
};

export const EXAMPLE_DRAFT: ListingDraft = {
  slug: EXAMPLE_MANIFEST.slug ?? 'my-premium-search',
  name: EXAMPLE_MANIFEST.name,
  description: EXAMPLE_MANIFEST.description,
  category: EXAMPLE_MANIFEST.category,
  endpoint: EXAMPLE_MANIFEST.endpoint,
  pricing: EXAMPLE_MANIFEST.pricing,
  endpoints: EXAMPLE_MANIFEST.endpoints ?? [],
  ...(EXAMPLE_MANIFEST.docs_url ? { docsUrl: EXAMPLE_MANIFEST.docs_url } : {}),
  freeTier: EXAMPLE_MANIFEST.free_tier ?? 0,
};
