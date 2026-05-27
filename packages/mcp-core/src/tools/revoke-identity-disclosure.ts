import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  id: z.string().min(1).describe('Disclosure grant id returned by create/list calls.'),
});

export const revokeIdentityDisclosureTool = defineTool({
  name: 'leash_revoke_identity_disclosure',
  description: [
    'Revoke a selective-disclosure grant owned by the active Leash agent using X-Leash-Sig.',
    'After revocation, the bearer-token disclosure URL no longer resolves.',
    'The call cannot revoke disclosure grants owned by another agent.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.revokeIdentityDisclosure(args),
});
