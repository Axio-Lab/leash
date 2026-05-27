import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  include_disabled: z
    .boolean()
    .optional()
    .describe('Include disabled/revoked keys. Defaults to false.'),
  limit: z.number().int().min(1).max(200).optional().describe('Maximum keys to return.'),
});

export const listAgentApiKeysTool = defineTool({
  name: 'leash_list_agent_api_keys',
  description: [
    'List API keys created by the active Leash agent.',
    'The response never includes plaintext secrets; it only returns id, label, network, prefix, last4, owner wallet, scope, and timestamps.',
    'Use this before revoking a key or to confirm which runtime credentials exist for the current agent.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.listAgentApiKeys(args),
});
