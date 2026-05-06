import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  direction: z
    .enum(['both', 'outgoing', 'incoming'])
    .optional()
    .describe(
      'Filter by direction. `outgoing` = paid out, `incoming` = received. Defaults to both.',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe('Max receipts to return (server-capped at 200). Defaults to 25.'),
});

export const receiptsTool = defineTool({
  name: 'leash_receipts',
  description: [
    'List recent payment receipts for the active agent (x402 and MPP v0.2) — every payment sent or received, newest first.',
    'Each receipt carries a Solana tx_signature and a deterministic receipt_hash so the user can verify on Solscan or the Leash explorer.',
    'On `status: "ok"`, surface a short summary (count + total volume + most-recent counterparty) and offer a link to the explorer URL. Quote tx hashes as inline `code`.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.receipts(args),
});
