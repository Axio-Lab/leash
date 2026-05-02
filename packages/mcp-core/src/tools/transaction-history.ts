/**
 * `leash_transaction_history` — list every receipt the active agent
 * has earned or spent within a configurable rolling window.
 *
 * This complements `leash_receipts` (which is paginated + open-ended)
 * by treating the question as "what happened in the last N days?".
 * The host paginates the underlying `/v1/receipts/{agent}` feed,
 * trims to the window client-side (newest-first → break on the first
 * row older than `now - days`), and returns:
 *
 *   - The receipts themselves (canonical fields the LLM can quote
 *     verbatim: hash, direction, decision, amount, currency, tx_sig,
 *     timestamp, request URL).
 *   - Running totals for the window: `total_sent_usd`,
 *     `total_received_usd`, `net_usd`, plus per-direction counts.
 *
 * All Leash-supported stables (USDC/USDG/USDT) are summed as USD 1:1
 * \u2014 every receipt amount is already a decimal in the token's display
 * units. Receipts in non-stable currencies (rare, future) get counted
 * but excluded from the USD totals.
 */

import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe(
      'Window size in days, anchored to "now". Defaults to 7 (a one-week rolling view). Capped at 90 server-side to keep responses bounded; for longer ranges paginate `leash_receipts` directly.',
    ),
  direction: z
    .enum(['both', 'outgoing', 'incoming'])
    .optional()
    .describe(
      'Filter the feed: `outgoing` = the agent paid (spend receipts), `incoming` = the agent was paid (earn receipts). Defaults to `both`.',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe(
      'Hard cap on the total receipts returned across pagination. Defaults to 200; the underlying feed page size stays at 200 so this only matters when the day window contains more.',
    ),
});

export const transactionHistoryTool = defineTool({
  name: 'leash_transaction_history',
  description: [
    "List the active agent's earn + spend receipts within a rolling day-window (last 7 days by default).",
    'Returns the receipts (newest-first) plus aggregate totals: total_sent_usd, total_received_usd, net_usd, and per-direction counts. Stables (USDC/USDG/USDT) are summed as USD 1:1.',
    'Use this when the user asks "what did my agent do this week?", "show me last 30 days of payments", or wants a quick P&L summary. For "today only" pass `days: 1`. For deep paging (>90d) fall back to `leash_receipts`.',
    'On `status: "ok"`, the `range` block names the window (`from`, `to`, `days`) and `count` is the number of receipts returned.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.transactionHistory(args),
});
