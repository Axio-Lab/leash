import { IdentityProfileUpdateSchema } from '@leashmarket/schemas';

import { defineTool } from '../tool.js';

export const updateIdentityProfileTool = defineTool({
  name: 'leash_update_identity_profile',
  description: [
    'Update the active agent identity profile using X-Leash-Sig.',
    'Can set or clear the public handle, replace the full capability_cards array, and update profile visibility metadata.',
    'Use capability_cards for public/private capability cards that other agents can resolve or selectively disclose.',
  ].join(' '),
  inputSchema: IdentityProfileUpdateSchema,
  handler: async (args, ctx) => ctx.updateIdentityProfile(args),
});
