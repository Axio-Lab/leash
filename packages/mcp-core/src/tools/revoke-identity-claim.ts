import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  id: z.string().min(1).describe('Claim id returned by create/profile calls.'),
});

export const revokeIdentityClaimTool = defineTool({
  name: 'leash_revoke_identity_claim',
  description: [
    'Revoke an identity claim owned by the active Leash agent using X-Leash-Sig.',
    'Revoked claims stop appearing on public profiles and selective-disclosure reads.',
    'The call cannot revoke claims owned by another agent.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.revokeIdentityClaim(args),
});
