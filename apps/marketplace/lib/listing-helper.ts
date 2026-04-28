/**
 * Listing draft model and helpers used by the "list a tool" flow on
 * `leash.market/dev/list`.
 *
 * The flow itself is deliberately deterministic in Phase 2: we don't run
 * a chat LLM yet. The user pastes a manifest URL, we ask `apps/api` to
 * fetch + validate it (`POST /v1/marketplace/listings/from-url`), then
 * the user reviews + tweaks before submission. Phase 3 polish can swap
 * the form for a real LLM helper without changing the wire shape.
 */

export type ListingPricing = {
  type: 'free' | 'per_call' | 'variable';
  amount?: string;
  currency?: string;
};

export type ListingTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

export type ListingDraft = {
  slug: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricing: ListingPricing;
  tools: ListingTool[];
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
  tools: [],
  freeTier: 0,
};

export type ManifestImport = {
  name: string;
  slug: string | null;
  description: string;
  category: string;
  endpoint: string;
  tools: ListingTool[];
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
    tools: m.tools,
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
    d.tools.length > 0
  );
}
