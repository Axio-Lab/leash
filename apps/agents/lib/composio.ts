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
 * Fresh Tool Router session per turn with enabled toolkits derived from ACTIVE connections.
 */
export async function resolveComposioMcpForPrivy(privyId: string): Promise<McpServerConfig | null> {
  const composio = getComposio();
  if (!composio) return null;

  try {
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
      if (slug) slugs.add(slug);
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
