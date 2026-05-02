import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  capability: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Free-text capability label (e.g. "ocr", "weather", "image-generation").'),
  max_price_usdc: z
    .number()
    .positive()
    .max(1000)
    .optional()
    .describe('Maximum decimal USDC price per call. Listings above this cap are filtered out.'),
  pricing_type: z
    .enum(['free', 'per_call', 'variable'])
    .optional()
    .describe('Filter to a specific pricing model.'),
  limit: z.number().int().positive().max(100).optional(),
});

export const discoverTool = defineTool({
  name: 'leash_discover',
  description: [
    'Search the Leash marketplace for paid services by capability and price.',
    'Returns approved listings with their endpoint URL, pricing, seller wallet, and exposed tools.',
    'On `status: "ok"`, surface the top result(s) with title, price, and a one-line description so the user can pick. Quote endpoint URLs as inline `code`.',
    'Pair with `leash_reputation` to vet a seller before paying, and `leash_pay_payment_link` to actually transact.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.discover(args),
});
