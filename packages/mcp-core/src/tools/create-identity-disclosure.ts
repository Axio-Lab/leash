import { IdentityDisclosureCreateSchema } from '@leashmarket/schemas';

import { defineTool } from '../tool.js';

export const createIdentityDisclosureTool = defineTool({
  name: 'leash_create_identity_disclosure',
  description: [
    'Create a selective-disclosure grant for the active Leash agent using X-Leash-Sig.',
    'Resources can include private capability cards, private claims, and redacted receipt fields.',
    'The bearer token and share URL are returned once; store or share them before continuing.',
  ].join(' '),
  inputSchema: IdentityDisclosureCreateSchema,
  handler: async (args, ctx) => ctx.createIdentityDisclosure(args),
});
