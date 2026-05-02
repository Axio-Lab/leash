/**
 * Tool-definition primitive shared by every Leash MCP surface. A
 * `LeashTool` is host-agnostic data — name, description, Zod input
 * schema, and a handler that dispatches to the host's typed methods.
 *
 * Each runtime adapter (Claude Agent SDK in `apps/agents`, MCP SDK in
 * `packages/mcp`, CLI in `packages/cli`) wraps these definitions in
 * its own tool-registration call.
 */

import type { z } from 'zod';

import type { LeashHost } from './host.js';

/**
 * Result shape both Anthropic's Claude Agent SDK and `@modelcontextprotocol/sdk`
 * accept verbatim — a list of typed content parts. We only emit text
 * parts; the JSON payload is stringified into the single text content
 * (downstream models parse it as JSON).
 */
export type LeashToolResult = {
  content: { type: 'text'; text: string }[];
};

/**
 * A tool definition is intentionally non-generic on its `inputSchema`
 * so the canonical `LEASH_TOOLS` array can hold tools that have
 * different schemas without TypeScript variance complaints. Use the
 * `defineTool` helper below to author tools with type-safe arguments.
 */
export interface LeashTool {
  /** Tool name as exposed to the LLM (`leash_*` prefix is convention). */
  name: string;
  /** Description the LLM sees when deciding whether to call this tool. */
  description: string;
  /** Zod schema for the structured input arguments. */
  inputSchema: z.ZodTypeAny;
  /** Async handler. Returns whatever JSON shape makes sense for the host. */
  handler: (args: unknown, ctx: LeashHost) => Promise<LeashToolResult>;
}

/**
 * Authoring helper that preserves type-safe `args` inside the handler
 * while erasing the schema generic on the returned `LeashTool` so it
 * fits in the canonical array.
 */
export function defineTool<TSchema extends z.ZodTypeAny>(def: {
  name: string;
  description: string;
  inputSchema: TSchema;
  handler: (args: z.infer<TSchema>, ctx: LeashHost) => Promise<LeashToolResult>;
}): LeashTool {
  return def as unknown as LeashTool;
}

/**
 * Wrap an arbitrary JSON-serializable payload into the
 * `{ content: [{ type: 'text', text: <stringified> }] }` shape both
 * SDKs expect. Used by every tool's handler so the on-the-wire format
 * stays consistent.
 */
export function jsonResult(payload: unknown): LeashToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/**
 * Helper for the `agentMint == null` branch most tools share — surfaces
 * a `no_agent` JSON blob the LLM is trained to format as "ask the user
 * to mint an agent first".
 */
export function noAgentResult(kind: string, message?: string): LeashToolResult {
  return jsonResult({
    kind,
    status: 'no_agent',
    message:
      message ??
      'No on-chain agent yet. Mint one with the leash_register_agent tool (or under Profile → Agent in the chat UI) before calling this tool.',
  });
}
