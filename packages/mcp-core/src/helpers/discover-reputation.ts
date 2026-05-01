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
import type { DiscoverArgs, ReputationArgs, SvmNetwork } from '../host.js';

export type DiscoverItem = {
  url: string;
  title: string;
  description: string;
  slug: string;
  category: string;
  price_usdc: string | null;
  pricing_type: 'free' | 'per_call' | 'variable';
  seller_agent_mint: string | null;
  seller_wallet: string;
  rating: number | null;
  health_status: 'ok' | 'warn' | 'down' | null;
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
