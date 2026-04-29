import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import { resolveComposioMcpForPrivy } from '@/lib/composio';

import { createLeashMcpServer } from './leash-mcp';

export type ToolRegistryContext = {
  privyId: string;
  agentMint?: string | null;
};

/**
 * Union Composio Tool Router (HTTP MCP) + in-process Leash MCP for each chat turn.
 */
export async function resolveMcpServers(
  ctx: ToolRegistryContext,
): Promise<Record<string, McpServerConfig>> {
  const servers: Record<string, McpServerConfig> = {};

  const composio = await resolveComposioMcpForPrivy(ctx.privyId);
  if (composio) {
    servers.composio = composio;
  }

  servers.leash = createLeashMcpServer({
    privyId: ctx.privyId,
    agentMint: ctx.agentMint,
  });

  return servers;
}

const MAX_HEADER = 4096;

export function mergeSkillFragmentsHeader(raw: string | null): string {
  if (!raw || raw.length === 0) return '';
  if (raw.length > MAX_HEADER) {
    return '';
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return '';
    const fragments = parsed
      .filter((x): x is { systemPromptFragment?: string } => typeof x === 'object' && x !== null)
      .map((x) => x.systemPromptFragment)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    return fragments.join('\n\n');
  } catch {
    return '';
  }
}
