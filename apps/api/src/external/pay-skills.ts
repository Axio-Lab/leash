/**
 * pay.sh `pay-skills` provider catalogue client.
 *
 * The Solana Foundation publishes a community-curated index of
 * stablecoin-gated APIs at
 * `https://storage.googleapis.com/pay-skills/v1/skills.json`. Every
 * provider listed there has been gated by CI to:
 *
 *   - return HTTP 402 with a valid x402 (or MPP) challenge,
 *   - settle on Solana mainnet,
 *   - accept USDC or USDT.
 *
 * That makes the catalogue a clean second source for `/v1/discover`:
 * any URL it surfaces is, by construction, payable from a Leash agent
 * via `@leashmarket/buyer-kit` once the agent's treasury holds USDC/USDT.
 *
 * This module is server-side only — it owns one in-memory cache so
 * every API instance refreshes the 55KB index at most once per
 * `CACHE_TTL_MS` window. On transient failures we serve the previous
 * payload (stale-while-revalidate) so a Google CDN hiccup never
 * degrades `/v1/discover`.
 *
 * Override the URL via `LEASH_PAY_SKILLS_INDEX_URL` for staging /
 * private mirrors.
 */

const DEFAULT_INDEX_URL = 'https://storage.googleapis.com/pay-skills/v1/skills.json';
const DEFAULT_BASE_URL = 'https://storage.googleapis.com/pay-skills/v1';
const CACHE_TTL_MS = 10 * 60 * 1000;
const PROVIDER_CACHE_TTL_MS = 30 * 60 * 1000;
// 5s for the small index, 30s for per-provider details — the
// detail JSONs are 0.3–1 MB each and GCS routinely needs 5–10s
// per response (more for the largest providers). The cache TTL is
// 30 minutes, so this latency only ever shows up once per provider
// per process.
const FETCH_TIMEOUT_MS = 5_000;
const PROVIDER_FETCH_TIMEOUT_MS = 30_000;

export type PaySkillsProvider = {
  fqn: string;
  title: string;
  description: string;
  use_case: string;
  category: string;
  service_url: string;
  endpoint_count?: number;
  has_metering?: boolean;
  has_free_tier?: boolean;
  min_price_usd?: number;
  max_price_usd?: number;
  sha?: string;
};

export type PaySkillsIndex = {
  version: number;
  generated_at: string;
  base_url: string;
  provider_count: number;
  providers: PaySkillsProvider[];
};

/**
 * Normalised pay-skills item shaped to match `DiscoverItem` so the
 * discover route can return a single, uniform `items[]` to callers.
 * Distinguishing tag is `source: 'pay-skills'`.
 */
export type PaySkillsItem = {
  source: 'pay-skills';
  url: string;
  title: string;
  description: string;
  slug: string;
  category: string;
  price_usdc: string | null;
  pricing_type: 'free' | 'per_call' | 'variable';
  seller_agent_mint: null;
  seller_wallet: null;
  rating: null;
  health_status: null;
  endpoint_count?: number;
  tags: string[];
  tools: Array<{ name: string; description: string }>;
};

export type SearchPaySkillsArgs = {
  capability?: string;
  max_price_usdc?: number;
  pricing_type?: 'free' | 'per_call' | 'variable';
  limit?: number;
  fetchImpl?: typeof globalThis.fetch;
  indexUrl?: string;
};

type CacheEntry = { value: PaySkillsIndex; loadedAt: number };

let cached: CacheEntry | null = null;
let inflight: Promise<PaySkillsIndex> | null = null;

function resolveIndexUrl(override?: string): string {
  if (override) return override;
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.LEASH_PAY_SKILLS_INDEX_URL : undefined;
  return fromEnv ?? DEFAULT_INDEX_URL;
}

async function fetchOnce(args: {
  fetchImpl: typeof globalThis.fetch;
  url: string;
}): Promise<PaySkillsIndex> {
  // AbortSignal.timeout is widely available on Node 22+ but we
  // optional-chain so unit tests with a stripped-down mock still work.
  const init: RequestInit | undefined =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
      : undefined;
  const res = await args.fetchImpl(args.url, init);
  if (!res.ok) {
    throw new Error(`pay-skills fetch ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as PaySkillsIndex;
  if (!json || typeof json !== 'object' || !Array.isArray(json.providers)) {
    throw new Error('pay-skills index malformed: missing providers[]');
  }
  return json;
}

async function loadIndex(args: {
  fetchImpl?: typeof globalThis.fetch;
  indexUrl?: string;
}): Promise<PaySkillsIndex> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  if (inflight) return inflight;

  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const url = resolveIndexUrl(args.indexUrl);

  inflight = fetchOnce({ fetchImpl, url })
    .then((value) => {
      cached = { value, loadedAt: Date.now() };
      return value;
    })
    .finally(() => {
      inflight = null;
    });

  try {
    return await inflight;
  } catch (err) {
    // Stale-while-revalidate: a transient outage never breaks /v1/discover.
    if (cached) return cached.value;
    throw err;
  }
}

function pricingFromProvider(p: PaySkillsProvider): {
  pricing_type: PaySkillsItem['pricing_type'];
  price_usdc: string | null;
} {
  const min = Number.isFinite(p.min_price_usd) ? Number(p.min_price_usd) : 0;
  const max = Number.isFinite(p.max_price_usd) ? Number(p.max_price_usd) : 0;
  if (min === 0 && max === 0) return { pricing_type: 'free', price_usdc: null };
  if (min === max) return { pricing_type: 'per_call', price_usdc: min.toString() };
  return { pricing_type: 'variable', price_usdc: null };
}

function matchesQuery(p: PaySkillsProvider, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [p.title, p.description, p.use_case, p.category, p.fqn];
  return haystacks.some((h) => typeof h === 'string' && h.toLowerCase().includes(needle));
}

export function providerToItem(p: PaySkillsProvider): PaySkillsItem {
  const { pricing_type, price_usdc } = pricingFromProvider(p);
  return {
    source: 'pay-skills',
    url: p.service_url,
    title: p.title,
    description: p.description,
    slug: p.fqn,
    category: p.category,
    price_usdc,
    pricing_type,
    seller_agent_mint: null,
    seller_wallet: null,
    rating: null,
    health_status: null,
    ...(typeof p.endpoint_count === 'number' ? { endpoint_count: p.endpoint_count } : {}),
    tags: p.category ? [p.category] : [],
    tools: [],
  };
}

/**
 * Search the pay-skills catalogue with the same filter semantics
 * `/v1/discover` applies to its own listings table, so the merged
 * response is consistent regardless of source.
 *
 * Filtering rules:
 *   - `capability`: case-insensitive substring match against title /
 *     description / use_case / category / fqn (mirrors the OpenAPI
 *     `capability` field's docs).
 *   - `max_price_usdc`: applies to per_call (price) and variable
 *     (min price) entries. Free entries always pass.
 *   - `pricing_type`: equality.
 *   - `limit`: caps the returned count.
 *
 * Returns `[]` (rather than throwing) when the catalogue is
 * unavailable AND no stale copy exists — the caller can still serve
 * the Leash listings half of `/v1/discover`.
 */
export async function searchPaySkills(args: SearchPaySkillsArgs): Promise<PaySkillsItem[]> {
  let index: PaySkillsIndex;
  try {
    index = await loadIndex({
      ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
      ...(args.indexUrl ? { indexUrl: args.indexUrl } : {}),
    });
  } catch {
    return [];
  }

  const cap = args.max_price_usdc != null ? args.max_price_usdc : Number.POSITIVE_INFINITY;
  const limit = args.limit && args.limit > 0 ? args.limit : Number.MAX_SAFE_INTEGER;

  const out: PaySkillsItem[] = [];
  for (const p of index.providers) {
    if (args.capability && !matchesQuery(p, args.capability)) continue;

    const { pricing_type, price_usdc } = pricingFromProvider(p);
    if (args.pricing_type && pricing_type !== args.pricing_type) continue;

    if (pricing_type === 'per_call' && price_usdc != null) {
      const num = Number(price_usdc);
      if (Number.isFinite(num) && num > cap) continue;
    } else if (pricing_type === 'variable') {
      const min = Number(p.min_price_usd);
      if (Number.isFinite(min) && min > cap) continue;
    }

    out.push(providerToItem(p));
    if (out.length >= limit) break;
  }
  return out;
}

// ── per-provider detail fetch ───────────────────────────────────────────────
//
// pay-skills publishes a per-provider JSON at
// `<base_url>/providers/<fqn>.json` (discovered empirically; see
// `scripts/verify-discover-pipeline.mjs` for a smoke check).
// `endpoints[]` list with `{ method, path, description, pricing,
// protocol, supported_usd, probe_status, probe_description }` plus
// the upstream OpenAPI document. The agent flow is:
//
//   leash_discover (search_skills equivalent)
//     -> leash_pay_skills_endpoints  (this — get_skill_endpoints)
//     -> leash_pay_payment_link      (curl equivalent)

export type PaySkillsEndpointPricing = {
  mode?: string;
  dimensions?: Array<{
    direction?: string;
    scale?: number;
    unit?: string;
    tiers?: Array<{ price_usd?: number; threshold?: number }>;
  }>;
};

export type PaySkillsEndpoint = {
  method: string;
  path: string;
  description?: string;
  resource?: string;
  pricing?: PaySkillsEndpointPricing;
  protocol?: string[];
  supported_usd?: string[];
  probe_status?: string;
  probe_description?: string;
};

export type PaySkillsProviderDetail = {
  fqn: string;
  title: string;
  description: string;
  use_case?: string;
  category: string;
  service_url: string;
  version?: string;
  endpoints: PaySkillsEndpoint[];
  /**
   * `endpoints[i].path` is relative to `service_url`. This field is
   * the joined absolute URL — what the agent should hand straight
   * to `leash_pay_payment_link` / `buyer.fetch()`.
   */
  endpoint_urls: string[];
};

type ProviderCacheEntry = { value: PaySkillsProviderDetail; loadedAt: number };
const providerCache = new Map<string, ProviderCacheEntry>();
const providerInflight = new Map<string, Promise<PaySkillsProviderDetail>>();

function resolveBaseUrl(override?: string): string {
  if (override) return override.replace(/\/+$/, '');
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.LEASH_PAY_SKILLS_BASE_URL : undefined;
  return (fromEnv ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

function normaliseProvider(raw: unknown): PaySkillsProviderDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fqn = typeof r.fqn === 'string' ? r.fqn : null;
  const service_url = typeof r.service_url === 'string' ? r.service_url : null;
  if (!fqn || !service_url) return null;
  const endpoints: PaySkillsEndpoint[] = Array.isArray(r.endpoints)
    ? (r.endpoints as unknown[])
        .map((e): PaySkillsEndpoint | null => {
          if (!e || typeof e !== 'object') return null;
          const ep = e as Record<string, unknown>;
          const method = typeof ep.method === 'string' ? ep.method : null;
          const path = typeof ep.path === 'string' ? ep.path : null;
          if (!method || !path) return null;
          const out: PaySkillsEndpoint = { method, path };
          if (typeof ep.description === 'string') out.description = ep.description;
          if (typeof ep.resource === 'string') out.resource = ep.resource;
          if (ep.pricing && typeof ep.pricing === 'object') {
            out.pricing = ep.pricing as PaySkillsEndpointPricing;
          }
          if (Array.isArray(ep.protocol))
            out.protocol = (ep.protocol as unknown[]).filter(
              (p): p is string => typeof p === 'string',
            );
          if (Array.isArray(ep.supported_usd))
            out.supported_usd = (ep.supported_usd as unknown[]).filter(
              (s): s is string => typeof s === 'string',
            );
          if (typeof ep.probe_status === 'string') out.probe_status = ep.probe_status;
          if (typeof ep.probe_description === 'string')
            out.probe_description = ep.probe_description;
          return out;
        })
        .filter((e): e is PaySkillsEndpoint => e != null)
    : [];

  return {
    fqn,
    title: typeof r.title === 'string' ? r.title : fqn,
    description: typeof r.description === 'string' ? r.description : '',
    ...(typeof r.use_case === 'string' ? { use_case: r.use_case } : {}),
    category: typeof r.category === 'string' ? r.category : 'other',
    service_url,
    ...(typeof r.version === 'string' ? { version: r.version } : {}),
    endpoints,
    endpoint_urls: endpoints.map((e) => joinUrl(service_url, e.path)),
  };
}

export type GetPaySkillsProviderArgs = {
  fqn: string;
  fetchImpl?: typeof globalThis.fetch;
  baseUrl?: string;
};

/**
 * Fetch the per-provider detail JSON for a pay-skills FQN
 * (`<operator>/<name>` or `<operator>/<origin>/<name>`).
 *
 * Caches per-FQN with a 30-min TTL. Returns `null` when the
 * provider isn't published or a transient fetch error has no
 * stale fallback.
 */
export async function getPaySkillsProvider(
  args: GetPaySkillsProviderArgs,
): Promise<PaySkillsProviderDetail | null> {
  const fqn = args.fqn.trim().replace(/^\/+|\/+$/g, '');
  if (!fqn) return null;
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const base = resolveBaseUrl(args.baseUrl);
  const cacheKey = `${base}::${fqn}`;

  const now = Date.now();
  const hit = providerCache.get(cacheKey);
  if (hit && now - hit.loadedAt < PROVIDER_CACHE_TTL_MS) return hit.value;

  const ongoing = providerInflight.get(cacheKey);
  if (ongoing) return ongoing;

  const url = `${base}/providers/${fqn}.json`;
  const promise = (async () => {
    const init: RequestInit | undefined =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS) }
        : undefined;
    const res = await fetchImpl(url, init);
    if (res.status === 404) {
      throw new Error('not_found');
    }
    if (!res.ok) {
      throw new Error(`pay-skills provider fetch ${res.status}: ${res.statusText}`);
    }
    const json = (await res.json()) as unknown;
    const norm = normaliseProvider(json);
    if (!norm) throw new Error('pay-skills provider response malformed');
    providerCache.set(cacheKey, { value: norm, loadedAt: Date.now() });
    return norm;
  })();
  providerInflight.set(cacheKey, promise);

  try {
    return await promise;
  } catch (err) {
    if (err instanceof Error && err.message === 'not_found') return null;
    // Surface transient upstream failures in dev. We keep the helper
    // best-effort (the route falls back to 404 + "not found" copy);
    // the log just makes the difference between "missing FQN" and
    // "GCS slow / DNS / CORS hiccup" debuggable without a stack trace.
    const cause =
      err instanceof Error && 'cause' in err
        ? (err as Error & { cause?: unknown }).cause
        : undefined;
    // eslint-disable-next-line no-console
    console.warn(
      `[pay-skills] provider fetch failed for ${cacheKey}: ${
        err instanceof Error ? err.message : String(err)
      }${cause ? ` (cause: ${cause instanceof Error ? cause.message : String(cause)})` : ''}`,
    );
    if (hit) return hit.value;
    return null;
  } finally {
    providerInflight.delete(cacheKey);
  }
}

/** Test-only — drop the in-memory cache between cases. */
export function _resetPaySkillsCacheForTests(): void {
  cached = null;
  inflight = null;
  providerCache.clear();
  providerInflight.clear();
}
