import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  mint: z.string().min(32).max(44).optional().describe('Agent mint / MPL Core asset address.'),
  handle: z.string().min(1).optional().describe('Human-readable Leash handle, with or without @.'),
  domain: z.string().min(1).optional().describe('Verified domain attached to an agent identity.'),
  intent: z
    .enum(['pay', 'call_capability', 'trust_claim', 'inspect'])
    .optional()
    .describe('Optional trust-decision intent. When present, the tool returns allow/warn/deny.'),
  capability: z
    .object({
      kind: z.string().optional(),
      slug: z.string().optional(),
      endpoint: z.string().url().optional(),
      protocol: z.enum(['x402', 'mpp']).optional(),
    })
    .optional()
    .describe('Optional capability requirement to match against public capability cards.'),
  thresholds: z
    .object({
      min_rating: z.number().min(0).max(1).optional(),
      required_claim_types: z.array(z.string().min(1)).optional(),
      require_verified_domain: z.boolean().optional(),
    })
    .optional()
    .describe('Optional trust thresholds for the verification decision.'),
});

export const verifyIdentityTool = defineTool({
  name: 'leash_verify_identity',
  description:
    'Verify that a mint, handle, or domain resolves to a live Leash agent identity. With intent/capability/thresholds, returns an allow/warn/deny trust verdict before paying, trusting claims, or calling a capability. Provide exactly one selector.',
  inputSchema,
  handler: async (args, ctx) => ctx.verifyIdentity(args),
});
