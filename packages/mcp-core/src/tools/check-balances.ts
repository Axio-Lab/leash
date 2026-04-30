import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  symbol: z
    .string()
    .optional()
    .describe('Optional ticker filter — e.g. "USDC". When omitted, returns all balances.'),
});

export const checkBalancesTool = defineTool({
  name: 'leash_check_treasury_balance',
  description:
    'Read the agent treasury balance — SOL plus every SPL token held (USDC, USDG, USDT pinned even when zero).',
  inputSchema,
  handler: async (args, ctx) => ctx.checkTreasuryBalance(args),
});
