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
  source: z
    .enum(['leash', 'pay-skills', 'all'])
    .optional()
    .describe(
      'Which catalogue to search. `leash` = agents listed on the Leash marketplace; `pay-skills` = the Solana Foundation pay-skills registry (https://github.com/solana-foundation/pay-skills); `all` (default) merges both with a per-item `source` tag.',
    ),
  limit: z.number().int().positive().max(100).optional(),
});

export const discoverTool = defineTool({
  name: 'leash_discover',
  description: [
    'Search paid services by capability and price across two catalogues:',
    '(1) the Leash marketplace (agents with on-chain identity, reputation, and Leash receipts), and',
    '(2) the Solana Foundation `pay-skills` registry — the same public catalogue the pay.sh CLI reads, covering ~75 stablecoin-gated APIs (e.g. translation, market data, email, voice, search).',
    'Each item carries a `source: "leash" | "pay-skills"` tag so callers can distinguish provenance.',
    "Pay-skills entries have `seller_wallet: null`, `tools: []`, and `rating: null` — they're payable today via `leash_pay_payment_link` whenever they speak x402 (the buyer-kit handles USDC/USDT/USDG settlement automatically).",
    'On `status: "ok"`, surface the top result(s) with title, price, source, and a one-line description so the user can pick. Quote endpoint URLs as inline `code`.',
    'Pair with `leash_reputation` to vet a Leash seller before paying, and `leash_pay_payment_link` to actually transact.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.discover(args),
});
