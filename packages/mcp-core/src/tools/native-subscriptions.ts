/**
 * `leash_native_subscriptions` — native Solana Subscriptions &
 * Allowances control plane for the active standalone agent wallet.
 */

import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  action: z
    .enum([
      'authority_status',
      'authority_create',
      'authority_close',
      'fixed_create',
      'fixed_transfer',
      'fixed_revoke',
      'recurring_create',
      'recurring_transfer',
      'recurring_revoke',
      'plan_create',
      'plan_update',
      'subscribe',
      'cancel',
      'resume',
      'revoke_subscription',
      'collect',
    ])
    .describe('Native subscriptions action to run.'),
  symbol: z.enum(['USDC', 'USDG', 'USDT']).optional().describe('Stable mint. Defaults to USDC.'),
  delegatee: z.string().optional(),
  delegator: z
    .string()
    .optional()
    .describe(
      'Executive / authorization wallet. For collect, omit to auto-resolve the on-chain debit account from the subscription PDA.',
    ),
  allowance: z.string().optional(),
  subscription: z.string().optional(),
  plan: z.string().optional(),
  merchant: z.string().optional(),
  receiver: z.string().optional(),
  receiver_token_account: z.string().optional(),
  amount: z.number().positive().optional(),
  amount_per_period: z.number().positive().optional(),
  period_length_seconds: z.number().int().positive().optional(),
  period_hours: z.number().int().positive().optional(),
  nonce: z.string().regex(/^\d+$/).optional(),
  plan_id: z.string().regex(/^\d+$/).optional(),
  start_ts: z.string().regex(/^\d+$/).optional(),
  expiry_ts: z.string().regex(/^\d+$/).optional(),
  end_ts: z.string().regex(/^\d+$/).optional(),
  status: z.enum(['active', 'sunset']).optional(),
  destinations: z.array(z.string()).max(4).optional(),
  pullers: z.array(z.string()).max(4).optional(),
  metadata_uri: z.string().max(256).optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  terms_url: z.string().url().optional(),
  support_url: z.string().url().optional(),
  funding_source: z
    .enum(['wallet', 'treasury'])
    .optional()
    .describe(
      'Which USDC token account is debited: wallet (executive/subscriber ATA) or treasury (agent Asset Signer PDA). MCP defaults to treasury when omitted. The executive wallet always signs agent flows.',
    ),
});

export const nativeSubscriptionsTool = defineTool({
  name: 'leash_native_subscriptions',
  description: [
    'Create and operate native Solana Subscriptions & Allowances for the active agent wallet.',
    'Supports subscription authority create/status/close, fixed allowances, recurring allowances, subscription plans, subscribe/cancel/resume/revoke, and collect.',
    'Native subscriptions debit either a wallet USDC ATA (wallet) or the agent treasury PDA (treasury). The executive wallet always signs agent flows. MCP defaults to treasury debits. x402/MPP still use the SPL delegation rail.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.nativeSubscriptions(args),
});
