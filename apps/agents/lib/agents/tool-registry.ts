import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import { resolveComposioMcpForPrivy } from '@/lib/composio';

import { defaultSkillFragments } from './default-skills';
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

/**
 * Merge the user's custom skill fragments (sent via `x-leash-skills`)
 * with the always-on default skill bundle. Defaults come first so the
 * agent's economic-actor / Solana grounding can't be unset by a user.
 */
export function mergeSkillFragmentsHeader(raw: string | null): string {
  const defaults = defaultSkillFragments();

  if (!raw || raw.length === 0) return defaults;
  if (raw.length > MAX_HEADER) return defaults;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaults;
    const customs = parsed
      .filter((x): x is { systemPromptFragment?: string } => typeof x === 'object' && x !== null)
      .map((x) => x.systemPromptFragment)
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .join('\n\n');
    return customs.length > 0 ? `${defaults}\n\n${customs}` : defaults;
  } catch {
    return defaults;
  }
}
