/**
 * Listing draft model and helpers used by the creator "List capability" flow.
 * The page is discovery-only: payable endpoints are created elsewhere, then
 * pasted here so Leash can publish provider metadata and endpoint rows.
 */

export type ListingPricing = {
  type: 'free' | 'per_call' | 'variable';
  amount?: string;
  currency?: ListingStableCurrency;
};

export type ListingPaymentProtocol = 'x402' | 'mpp';
export type ListingStableCurrency = 'USDC' | 'USDT' | 'USDG';

export type ListingEndpoint = {
  method: 'GET' | 'POST';
  url: string;
  description: string;
  pricing?: ListingPricing;
  protocol?: ListingPaymentProtocol[];
  supported_usd?: ListingStableCurrency[];
  expected_request_body?: Record<string, unknown>;
};

export type ListingDraft = {
  slug: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricing: ListingPricing;
  endpoints: ListingEndpoint[];
  docsUrl?: string;
  freeTier: number;
};

export const EMPTY_DRAFT: ListingDraft = {
  slug: '',
  name: '',
  description: '',
  category: 'misc',
  endpoint: '',
  pricing: { type: 'free' },
  endpoints: [],
  freeTier: 0,
};

export type ManifestImport = {
  name: string;
  slug: string | null;
  description: string;
  category: string;
  endpoint: string;
  endpoints?: ListingEndpoint[];
  tools?: Array<{ name: string; description: string }>;
  pricing: ListingPricing;
  docs_url?: string;
  free_tier?: number;
};

export function manifestToDraft(m: ManifestImport): ListingDraft {
  return {
    slug: (m.slug ?? slugify(m.name)).slice(0, 80),
    name: m.name,
    description: m.description,
    category: m.category || 'misc',
    endpoint: m.endpoint,
    pricing: m.pricing,
    endpoints:
      m.endpoints && m.endpoints.length > 0
        ? m.endpoints
        : (m.tools ?? []).map((tool) => ({
            method: 'POST' as const,
            url: m.endpoint,
            description: tool.description || tool.name,
            pricing: m.pricing,
          })),
    ...(m.docs_url ? { docsUrl: m.docs_url } : {}),
    freeTier: m.free_tier ?? 0,
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function isDraftComplete(d: ListingDraft): boolean {
  return (
    d.slug.length >= 2 &&
    /^[a-z0-9-]+$/.test(d.slug) &&
    d.name.trim().length > 0 &&
    d.description.trim().length > 0 &&
    d.endpoint.trim().length > 0 &&
    d.endpoints.length > 0
  );
}
