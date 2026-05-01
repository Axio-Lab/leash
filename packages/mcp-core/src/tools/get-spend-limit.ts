/**
 * `leash_get_spend_limit` — read the current SPL delegation + treasury
 * balance for an agent stable. Pure RPC read, host-agnostic.
 *
 * Returns the configured delegate pubkey (should equal the executive
 * after a successful mint), the delegated atomic amount + decimal
 * formatted version, and the current treasury balance.
 *
 * Useful before settlement to verify "yes, my agent can pay this $5
 * call" and after a `leash_set_spend_limit` to confirm the change
 * landed.
 */

import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  symbol: z
    .enum(['USDC', 'USDG', 'USDT'])
    .optional()
    .describe('SPL stable to inspect. Defaults to USDC.'),
});

export const getSpendLimitTool = defineTool({
  name: 'leash_get_spend_limit',
  description: [
    'Read the current SPL `Approve` delegation + treasury balance for the active agent.',
    'Reports `delegate` (the pubkey authorised to spend), `delegated_amount` (the remaining cap in atomic + decimal units), and `balance` (the current treasury balance for the symbol).',
    'Pure on-chain read; pair with `leash_set_spend_limit` to update.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.getSpendLimit(args),
});
