/**
 * `leash_set_spend_limit` — owner-driven update of the SPL `Approve`
 * delegation that lets the executive spend stables out of the agent
 * treasury PDA.
 *
 * Why this exists
 * ---------------
 * On mint, `mintAgentLocally` writes `u64::MAX` so the very first
 * `leash_pay_payment_link` doesn't fail with `no_delegate`. That's the
 * right default for a fresh agent — but operators sometimes want
 * tighter control:
 *
 *   - Set a hard cap (e.g. $100 USDC) the agent cannot exceed without
 *     an explicit re-approval.
 *   - Revoke entirely while paused / under maintenance.
 *   - Bump the cap back to unlimited after a revoke.
 *
 * The standalone MCP signs the tx with the local owner keypair; the
 * chat product returns a `manual` artifact and points the user at
 * Profile → Agent (browser-side signing via Privy).
 */

import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  symbol: z
    .enum(['USDC', 'USDG', 'USDT'])
    .optional()
    .describe(
      'SPL stable to update the delegation for. Defaults to USDC. The agent treasury can hold each independently — set per-mint as needed.',
    ),
  mode: z
    .enum(['unlimited', 'revoke', 'amount'])
    .optional()
    .describe(
      '`unlimited` (default) — write `u64::MAX`, the protocol default. `revoke` — drop the delegation entirely; the executive can no longer move funds from the treasury until you re-approve. `amount` — set a custom cap, requires the `amount` field.',
    ),
  amount: z
    .number()
    .positive()
    .max(1_000_000_000)
    .optional()
    .describe(
      'Required when `mode: "amount"`. Decimal amount in human-readable token units (e.g. `100` = $100 USDC). The host applies the mint\'s `decimals` automatically.',
    ),
});

export const setSpendLimitTool = defineTool({
  name: 'leash_set_spend_limit',
  description: [
    "Update the SPL `Approve` delegation that lets the agent's executive keypair spend stables from the treasury PDA.",
    'On mint Leash writes unlimited (`u64::MAX`) so the agent can settle x402 payments without a `no_delegate` failure. Use this tool to tighten, loosen, or revoke that authority later.',
    'Pass `mode: "amount"` + `amount` to set a per-token cap (e.g. $100 USDC). Pass `mode: "revoke"` to zero it out; the agent will not be able to settle outgoing payments until you re-approve. Pass `mode: "unlimited"` (or omit `mode`) to restore the default.',
    'Owner-only — the tx is signed locally with the executive/owner keypair (`mpl-core::Execute(SPL.Approve|Revoke)`). Effects are immediate on confirmation.',
    'Reading: pair this with `leash_get_spend_limit` to inspect the current delegation + treasury balance before / after the change.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.setSpendLimit(args),
});
