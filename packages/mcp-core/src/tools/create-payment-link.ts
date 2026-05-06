import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  amount: z
    .number()
    .positive()
    .describe('Amount the buyer must pay. Use whole units (e.g. 20 for 20 USDC).'),
  currency: z
    .enum(['USDC', 'USDG', 'USDT'])
    .default('USDC')
    .describe('Stablecoin to charge in. Defaults to USDC.'),
  label: z
    .string()
    .min(1)
    .max(120)
    .describe('Human-readable label for the link (e.g. "Coffee — large").'),
  description: z.string().max(500).optional(),
  protocol: z
    .enum(['x402', 'mpp'])
    .optional()
    .describe(
      'Paywall protocol: `x402` (HTTP 402 + payment-required) or `mpp` (application/problem+json + MPP settle). Defaults to x402.',
    ),
});

export const createPaymentLinkTool = defineTool({
  name: 'leash_create_payment_link',
  description: [
    'Create a payment link (x402 or MPP) the user (or another agent) can call to pay this agent in USDC/USDG/USDT.',
    'Requires an on-chain agent (treasury). Returns the public share URL on success — quote it back as a markdown link.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.createPaymentLink(args),
});
