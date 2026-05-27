import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({});

export const getIdentityProfileTool = defineTool({
  name: 'leash_get_identity_profile',
  description: [
    'Fetch the editable identity profile for the active Leash agent using X-Leash-Sig.',
    'Returns handle, verified domains, all capability cards including private cards, active claims, operator history, and reputation.',
    'Requires an on-chain agent configured in the host.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.getIdentityProfile(args),
});
