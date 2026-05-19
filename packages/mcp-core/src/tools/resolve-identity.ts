import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  mint: z.string().min(32).max(44).optional().describe('Agent mint / MPL Core asset address.'),
  handle: z.string().min(1).optional().describe('Human-readable Leash handle, with or without @.'),
  domain: z.string().min(1).optional().describe('Verified domain attached to an agent identity.'),
});

export const resolveIdentityTool = defineTool({
  name: 'leash_resolve_identity',
  description:
    'Resolve a Leash agent identity by mint, human-readable handle, or verified domain. Returns the public profile: mint, network, handle, verified domains, public capability cards, public claims, and reputation summary. Provide exactly one selector.',
  inputSchema,
  handler: async (args, ctx) => ctx.resolveIdentity(args),
});
