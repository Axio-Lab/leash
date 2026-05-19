import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  mint: z.string().min(32).max(44).optional().describe('Agent mint / MPL Core asset address.'),
  handle: z.string().min(1).optional().describe('Human-readable Leash handle, with or without @.'),
  domain: z.string().min(1).optional().describe('Verified domain attached to an agent identity.'),
});

export const verifyIdentityTool = defineTool({
  name: 'leash_verify_identity',
  description:
    'Verify that a mint, handle, or domain resolves to a live Leash agent identity. Use before paying, trusting claims, or calling a capability. Provide exactly one selector.',
  inputSchema,
  handler: async (args, ctx) => ctx.verifyIdentity(args),
});
