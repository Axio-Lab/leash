import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({});

export const listIdentityDisclosuresTool = defineTool({
  name: 'leash_list_identity_disclosures',
  description: [
    'List selective-disclosure grants created by the active Leash agent using X-Leash-Sig.',
    'Returns grant ids, resources, expiry, revocation status, and creation time.',
    'Plain bearer tokens are only returned when a disclosure is created, not when listed later.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.listIdentityDisclosures(args),
});
