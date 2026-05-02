import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  agent_mint: z
    .string()
    .min(32)
    .max(48)
    .describe("The other agent's MPL Core asset address (base58)."),
  network: z
    .enum(['solana-devnet', 'solana-mainnet'])
    .optional()
    .describe('Defaults to the active host network.'),
});

export const reputationTool = defineTool({
  name: 'leash_reputation',
  description: [
    'Fetch a live reputation snapshot for any on-chain Leash agent — settled-call volume, dispute rate, distinct counterparties, and a normalised rating in [0, 1].',
    'Use this to vet a counterparty before transacting. A new agent with `settled_calls: 0` is a fine first counterparty for small-value calls but should not be trusted with large sums.',
    'Pair with `leash_discover` (find candidates) and `leash_pay_payment_link` (transact).',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.reputation(args),
});
