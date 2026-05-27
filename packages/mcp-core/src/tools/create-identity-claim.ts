import { IdentityClaimCreateSchema } from '@leashmarket/schemas';

import { defineTool } from '../tool.js';

export const createIdentityClaimTool = defineTool({
  name: 'leash_create_identity_claim',
  description: [
    'Attach a signed public or private claim to the active Leash agent identity using X-Leash-Sig.',
    'Claims include issuer, type, value, signature, optional evidence URL, visibility, and optional expiry.',
    'Public active claims appear on identity resolve; private claims require a selective disclosure grant.',
  ].join(' '),
  inputSchema: IdentityClaimCreateSchema,
  handler: async (args, ctx) => ctx.createIdentityClaim(args),
});
