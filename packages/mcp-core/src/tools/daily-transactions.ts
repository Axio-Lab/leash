/**
 * `leash_daily_transactions` — bin the active agent's earn + spend
 * receipts by UTC day for a rolling window and return per-day
 * aggregates plus grand totals.
 *
 * Operates on the same underlying `/v1/receipts/{agent}` feed as
 * `leash_transaction_history`, but folds individual receipts into
 * per-date buckets. Each bucket reports:
 *
 *   - `date`              `YYYY-MM-DD` (UTC of `ingested_at`).
 *   - `sent_count`        # of outgoing (spend) receipts that day.
 *   - `sent_usd`          USD-equivalent total sent that day.
 *   - `received_count`    # of incoming (earn) receipts that day.
 *   - `received_usd`      USD-equivalent total received that day.
 *   - `net_usd`           `received_usd - sent_usd`.
 *
 * Days with zero activity are still emitted (filled with zeros) so
 * the LLM can render a continuous row without holes. Days are sorted
 * newest-first to match the rest of the receipt surface.
 *
 * Stables (USDC/USDG/USDT) are summed as USD 1:1; receipts in other
 * currencies are counted but excluded from the USD totals (with a
 * `non_usd_count` callout in the response).
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
      'Window size in days, anchored to "now" (UTC). Defaults to 7. Capped at 90 server-side; longer windows should use `leash_receipts` directly.',
    ),
});

export const dailyTransactionsTool = defineTool({
  name: 'leash_daily_transactions',
  description: [
    "Aggregate the active agent's earn + spend receipts into per-day buckets for a rolling window (last 7 days by default).",
    'Returns one row per UTC day with `sent_count`, `sent_usd`, `received_count`, `received_usd`, and `net_usd`. Days with no activity are emitted with zeros so the timeline stays continuous.',
    'Use this when the user asks "show me daily revenue", "did my agent spend yesterday?", or wants a sparkline-shaped P&L. For raw receipts in the same window use `leash_transaction_history`; for a single hash use `leash_get_receipt`.',
    'Stables (USDC/USDG/USDT) are summed as USD 1:1. The response carries a top-level `totals` block with grand totals for the window and a `non_usd_count` for any non-stable receipts that were counted but excluded from the USD math.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.dailyTransactions(args),
});
