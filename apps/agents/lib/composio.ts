import { Composio } from '@composio/core';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import { getServerEnv } from '@/lib/env';

let cached: Composio | null = null;

export function getComposio(): Composio | null {
  const env = getServerEnv();
  if (!env.composioApiKey) return null;
  if (!cached) {
    cached = new Composio({ apiKey: env.composioApiKey });
  }
  return cached;
}

function toAnthropicMcp(mcp: {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}): McpServerConfig {
  if (mcp.type === 'sse') {
    return { type: 'sse', url: mcp.url, headers: mcp.headers };
  }
  return { type: 'http', url: mcp.url, headers: mcp.headers };
}

/**
 * Per-user cache of the resolved Composio Tool Router MCP config plus
 * its in-flight resolution promise. Keyed by privyId.
 *
 * Why this exists: `composio.create()` does a network round-trip to
 * spin up a new Tool Router session every turn (often 500–1500 ms).
 * Repeating it for every chat message pushes the perceived
 * "first-paint" latency well past 2 s for active users. The Tool
 * Router URL is a stable handle the SDK can re-fetch tools from, so
 * reusing it across turns is safe — Composio's own SDK examples
 * recommend reusing the session.
 *
 * TTL is short (60 s) because we want toolkit additions/revocations
 * to take effect quickly. If a user enables a new connection we'll
 * pick it up on the next turn after the TTL expires; for snappier
 * feedback callers can call `invalidateComposioMcpCache(privyId)`.
 *
 * The `inflight` field collapses concurrent first-time turns onto a
 * single network resolution, avoiding a thundering-herd of
 * `composio.create()` calls when the user spams Enter.
 */
type CacheEntry = {
  mcp: McpServerConfig | null;
  expiresAt: number;
};

const SESSION_TTL_MS = 60_000;
const sessionCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<McpServerConfig | null>>();

function normaliseAllowedToolkits(toolkits?: string[]): string[] | null {
  if (!toolkits) return null;
  return [...new Set(toolkits.map((s) => s.trim()).filter(Boolean))].sort();
}

function cacheKey(privyId: string, allowedToolkits?: string[]): string {
  const allowed = normaliseAllowedToolkits(allowedToolkits);
  return `${privyId}:${allowed ? allowed.join(',') : '*'}`;
}

export function invalidateComposioMcpCache(privyId: string): void {
  for (const key of [...sessionCache.keys()]) {
    if (key === privyId || key.startsWith(`${privyId}:`)) sessionCache.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (key === privyId || key.startsWith(`${privyId}:`)) inflight.delete(key);
  }
}

async function buildComposioMcpForPrivy(
  privyId: string,
  allowedToolkits?: string[],
): Promise<McpServerConfig | null> {
  const composio = getComposio();
  if (!composio) return null;

  try {
    const allowed = normaliseAllowedToolkits(allowedToolkits);
    if (allowed && allowed.length === 0) return null;
    const allowSet = allowed ? new Set(allowed) : null;
    const listed = await composio.connectedAccounts.list({
      userIds: [privyId],
      statuses: ['ACTIVE'],
    });
    const items = 'items' in listed ? listed.items : [];
    const slugs = new Set<string>();
    for (const row of items) {
      const slug =
        row && typeof row === 'object' && 'toolkit' in row
          ? (row as { toolkit?: { slug?: string } }).toolkit?.slug
          : undefined;
      if (slug && (!allowSet || allowSet.has(slug))) slugs.add(slug);
    }
    if (slugs.size === 0) return null;

    const session = await composio.create(privyId, {
      manageConnections: true,
      toolkits: { enable: [...slugs] },
    });

    return toAnthropicMcp(session.mcp);
  } catch {
    return null;
  }
}

/**
 * Resolve the Composio Tool Router MCP config for the user, served
 * from a 60s in-process cache. Concurrent callers for the same user
 * coalesce onto a single resolution.
 */
export async function resolveComposioMcpForPrivy(
  privyId: string,
  allowedToolkits?: string[],
): Promise<McpServerConfig | null> {
  const now = Date.now();
  const key = cacheKey(privyId, allowedToolkits);
  const hit = sessionCache.get(key);
  if (hit && hit.expiresAt > now) return hit.mcp;

  const existingInflight = inflight.get(key);
  if (existingInflight) return existingInflight;

  const promise = (async () => {
    try {
      const mcp = await buildComposioMcpForPrivy(privyId, allowedToolkits);
      sessionCache.set(key, { mcp, expiresAt: Date.now() + SESSION_TTL_MS });
      return mcp;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}
