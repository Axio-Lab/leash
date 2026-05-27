import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(120)
    .describe('Human-readable label for the key, e.g. "production worker" or "local MCP".'),
});

export const createAgentApiKeyTool = defineTool({
  name: 'leash_create_agent_api_key',
  description: [
    'Create a Leash API key for the active agent using the local executive keypair, not an existing API key.',
    'The new key is owned by the agent executive public key, bound to the active agent mint, and scoped as exactly `agent`.',
    'The plaintext value is returned once in the tool result. Store it securely before continuing; list/revoke calls only show prefix and last4.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.createAgentApiKey(args),
});
