import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  id: z.string().min(1).describe('API key id returned by create/list.'),
});

export const revokeAgentApiKeyTool = defineTool({
  name: 'leash_revoke_agent_api_key',
  description: [
    'Disable an API key that belongs to the active Leash agent.',
    'The call is signed with the local executive keypair and cannot revoke keys for another agent, even if the same executive manages multiple agents.',
    'Use this when rotating leaked or obsolete runtime credentials.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.revokeAgentApiKey(args),
});
