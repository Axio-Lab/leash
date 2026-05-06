import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  url: z.string().url().describe('The full https://…/x/<id>?network=… payment link.'),
  method: z
    .enum(['GET', 'POST'])
    .optional()
    .describe('HTTP method for the paid request. Default GET.'),
  body: z.string().optional().describe('JSON (or other) body when using POST. Ignored for GET.'),
});

export const payPaymentLinkTool = defineTool({
  name: 'leash_pay_payment_link',
  description: [
    'Pay an x402 or MPP (Leash dual-protocol) payment link from the agent treasury under the per-action / per-task / per-day caps.',
    'Behaviour depends on the host runtime:',
    '  - In the chat product the call DOES NOT settle on its own — the operator key lives in the user’s Privy wallet, not the server. The tool probes the URL for a 402 quote and returns a `payment_request` artifact the chat UI renders as a "Pay" card. Reply with one short sentence telling the user to confirm in the Pay card below.',
    '  - In the standalone MCP / CLI runtime the call SETTLES the payment using the local executive keypair and returns a `payment_receipt` blob with the on-chain signature. Surface the receipt hash + amount in your reply.',
    'Inspect `kind` on the response to know which path you’re on.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.pay(args),
});
