/**
 * Shared HTTP wrappers for the public `/v1/discover` and
 * `/v1/agents/:mint/reputation` endpoints.
 *
 * Both surfaces (chat product + standalone MCP) call the same
 * Leash API; nothing host-specific happens here, so the fetcher
 * lives in the host-agnostic core. Adapters call these from their
 * `LeashHost.discover` / `LeashHost.reputation` methods.
 */

import type { LeashToolResult } from '../tool.js';
import { jsonResult } from '../tool.js';
import type {
  DiscoverArgs,
  IdentitySelectorArgs,
  PaySkillsProviderArgs,
  ReputationArgs,
  SvmNetwork,
} from '../host.js';

export type DiscoverSource = 'leash' | 'pay-skills';

export type DiscoverItem = {
  /**
   * Catalogue this entry came from. `'leash'` items are agents listed
   * on the Leash marketplace; `'pay-skills'` items come from the
   * Solana Foundation `pay-skills` registry and have no on-chain
   * seller identity.
   */
  source: DiscoverSource;
  url: string;
  title: string;
  description: string;
  slug: string;
  category: string;
  price_usdc: string | null;
  pricing_type: 'free' | 'per_call' | 'variable';
  seller_agent_mint: string | null;
  /** Owner wallet for Leash entries; null for pay-skills entries. */
  seller_wallet: string | null;
  rating: number | null;
  health_status: 'ok' | 'warn' | 'down' | null;
  endpoint_count?: number;
  tags: string[];
  tools: Array<{ name: string; description: string }>;
};

export type ReputationSnapshot = {
  agent_mint: string;
  network: SvmNetwork;
  total_volume_usdc: string;
  settled_calls: number;
  denied_calls: number;
  distinct_counterparties: number;
  dispute_rate: number;
  oldest_receipt_at: string | null;
  newest_receipt_at: string | null;
  rating: number;
};

export type PublicIdentityProfile = {
  mint: string;
  network: SvmNetwork;
  handle: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  treasury: string;
  services: Array<{ name: string; endpoint: string }>;
  verified_domains: string[];
  capability_cards: Array<{
    id: string;
    kind: string;
    title: string;
    description?: string;
    source?: string;
    slug?: string;
    endpoint?: string;
    tags: string[];
    protocols: string[];
    visibility: 'public' | 'private';
  }>;
  claims: Array<{
    id: string;
    issuer: string;
    subject_mint: string;
    type: string;
    value: string;
    evidence_url: string | null;
    signature: string;
    visibility: 'public' | 'private';
    expires_at: string | null;
    revoked_at: string | null;
    created_at: string;
  }>;
  operator_history: unknown[];
  reputation: { settled_calls: number; denied_calls: number; rating: number };
};

export type IdentityVerifyResponse = {
  verified: boolean;
  resolved_mint: string | null;
  network: SvmNetwork | null;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
};

function identitySearchParams(selector: IdentitySelectorArgs): URLSearchParams {
  const params = new URLSearchParams();
  if (selector.mint) params.set('mint', selector.mint);
  if (selector.handle) params.set('handle', selector.handle);
  if (selector.domain) params.set('domain', selector.domain);
  return params;
}

/**
 * GET /v1/discover. Returns the parsed payload as a `kind:
 * 'discover'` tool result so callers can return it verbatim.
 */
export async function fetchDiscover(args: {
  apiBaseUrl: string;
  network: SvmNetwork;
  query: DiscoverArgs;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<LeashToolResult> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const url = new URL(`${args.apiBaseUrl.replace(/\/+$/, '')}/v1/discover`);
  if (args.query.capability) url.searchParams.set('capability', args.query.capability);
  if (args.query.max_price_usdc != null) {
    url.searchParams.set('max_price_usdc', String(args.query.max_price_usdc));
  }
  if (args.query.pricing_type) url.searchParams.set('pricing_type', args.query.pricing_type);
  if (args.query.source) url.searchParams.set('source', args.query.source);
  if (args.query.limit) url.searchParams.set('limit', String(args.query.limit));

  try {
    const res = await fetchImpl(url);
    const text = await res.text();
    if (!res.ok) {
      return jsonResult({
        kind: 'discover',
        status: 'error',
        message: `Leash API ${res.status}: ${text.slice(0, 300)}`,
      });
    }
    const payload = JSON.parse(text) as { items: DiscoverItem[]; next_cursor: string | null };
    return jsonResult({
      kind: 'discover',
      status: 'ok',
      network: args.network,
      query: args.query,
      count: payload.items.length,
      items: payload.items,
      next_cursor: payload.next_cursor,
    });
  } catch (err) {
    return jsonResult({
      kind: 'discover',
      status: 'error',
      message: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

export type PaySkillsEndpoint = {
  method: string;
  path: string;
  url: string;
  description?: string;
  resource?: string;
  pricing?: {
    mode?: string;
    dimensions?: Array<{
      direction?: string;
      scale?: number;
      unit?: string;
      tiers?: Array<{ price_usd?: number; threshold?: number }>;
    }>;
  } | null;
  protocol?: string[];
  supported_usd?: string[];
  probe_status?: string;
  probe_description?: string;
};

export type PaySkillsProvider = {
  fqn: string;
  title: string;
  description: string;
  use_case?: string;
  category: string;
  service_url: string;
  version?: string;
  endpoints: PaySkillsEndpoint[];
};

/**
 * GET /v1/discover/pay-skills/:fqn. Expands a chosen pay-skills
 * provider into its endpoints[] so the agent can pay individual
 * paid endpoints (the second hop in pay.sh's `search_skills →
 * get_skill_endpoints → curl` flow).
 *
 * Returns a `kind: 'pay_skills_provider'` tool result.
 */
export async function fetchPaySkillsProvider(args: {
  apiBaseUrl: string;
  network: SvmNetwork;
  query: PaySkillsProviderArgs;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<LeashToolResult> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const fqn = args.query.fqn.trim().replace(/^\/+|\/+$/g, '');
  if (!fqn || !fqn.includes('/')) {
    return jsonResult({
      kind: 'pay_skills_provider',
      status: 'error',
      message: `pay-skills FQN must include at least one '/' (got "${args.query.fqn}")`,
    });
  }
  const segs = fqn
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  const url = `${args.apiBaseUrl.replace(/\/+$/, '')}/v1/discover/pay-skills/${segs}`;

  try {
    const res = await fetchImpl(url);
    const text = await res.text();
    if (res.status === 404) {
      return jsonResult({
        kind: 'pay_skills_provider',
        status: 'error',
        message: `pay-skills provider not found: ${fqn}`,
      });
    }
    if (!res.ok) {
      return jsonResult({
        kind: 'pay_skills_provider',
        status: 'error',
        message: `Leash API ${res.status}: ${text.slice(0, 300)}`,
      });
    }
    const payload = JSON.parse(text) as PaySkillsProvider;
    return jsonResult({
      kind: 'pay_skills_provider',
      status: 'ok',
      network: args.network,
      ...payload,
    });
  } catch (err) {
    return jsonResult({
      kind: 'pay_skills_provider',
      status: 'error',
      message: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

/**
 * GET /v1/agents/:mint/reputation. Returns a `kind: 'reputation'`
 * tool result for direct surfacing to the LLM.
 */
export async function fetchReputation(args: {
  apiBaseUrl: string;
  network: SvmNetwork;
  query: ReputationArgs;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<LeashToolResult> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const network = args.query.network ?? args.network;
  const url = new URL(
    `${args.apiBaseUrl.replace(/\/+$/, '')}/v1/agents/${encodeURIComponent(args.query.agent_mint)}/reputation`,
  );
  url.searchParams.set('network', network);

  try {
    const res = await fetchImpl(url);
    const text = await res.text();
    if (!res.ok) {
      return jsonResult({
        kind: 'reputation',
        status: 'error',
        message: `Leash API ${res.status}: ${text.slice(0, 300)}`,
      });
    }
    const payload = JSON.parse(text) as ReputationSnapshot;
    return jsonResult({
      kind: 'reputation',
      status: 'ok',
      ...payload,
    });
  } catch (err) {
    return jsonResult({
      kind: 'reputation',
      status: 'error',
      message: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

export async function fetchIdentityProfile(args: {
  apiBaseUrl: string;
  query: IdentitySelectorArgs;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<LeashToolResult> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const params = identitySearchParams(args.query);
  if ([args.query.mint, args.query.handle, args.query.domain].filter(Boolean).length !== 1) {
    return jsonResult({
      kind: 'identity_profile',
      status: 'error',
      message: 'provide exactly one of: mint, handle, domain',
    });
  }
  const url = `${args.apiBaseUrl.replace(/\/+$/, '')}/v1/identity/resolve?${params}`;
  try {
    const res = await fetchImpl(url);
    const text = await res.text();
    if (!res.ok) {
      return jsonResult({
        kind: 'identity_profile',
        status: 'error',
        message: `Leash API ${res.status}: ${text.slice(0, 300)}`,
      });
    }
    const payload = JSON.parse(text) as PublicIdentityProfile;
    return jsonResult({ kind: 'identity_profile', status: 'ok', ...payload });
  } catch (err) {
    return jsonResult({
      kind: 'identity_profile',
      status: 'error',
      message: err instanceof Error ? err.message : 'unknown error',
    });
  }
}

export async function fetchIdentityVerify(args: {
  apiBaseUrl: string;
  query: IdentitySelectorArgs;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<LeashToolResult> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const params = identitySearchParams(args.query);
  if ([args.query.mint, args.query.handle, args.query.domain].filter(Boolean).length !== 1) {
    return jsonResult({
      kind: 'identity_verify',
      status: 'error',
      message: 'provide exactly one of: mint, handle, domain',
    });
  }
  const url = `${args.apiBaseUrl.replace(/\/+$/, '')}/v1/identity/verify?${params}`;
  try {
    const res = await fetchImpl(url);
    const text = await res.text();
    if (!res.ok) {
      return jsonResult({
        kind: 'identity_verify',
        status: 'error',
        message: `Leash API ${res.status}: ${text.slice(0, 300)}`,
      });
    }
    const payload = JSON.parse(text) as IdentityVerifyResponse;
    return jsonResult({ kind: 'identity_verify', status: 'ok', ...payload });
  } catch (err) {
    return jsonResult({
      kind: 'identity_verify',
      status: 'error',
      message: err instanceof Error ? err.message : 'unknown error',
    });
  }
}
