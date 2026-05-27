import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  domain: z
    .string()
    .min(1)
    .describe('Domain to verify via https://domain/.well-known/leash-agent.json.'),
});

export const verifyIdentityDomainTool = defineTool({
  name: 'leash_verify_identity_domain',
  description: [
    'Verify a domain for the active Leash agent using X-Leash-Sig.',
    'The API fetches https://domain/.well-known/leash-agent.json and expects the configured agent mint, plus matching network when provided.',
    'Verified domains become public identity selectors for resolve and verify calls.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.verifyIdentityDomain(args),
});
