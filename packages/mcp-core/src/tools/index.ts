/**
 * Canonical list of Leash MCP tools shared across every host
 * (chat product, standalone STDIO MCP, CLI, future surfaces).
 *
 * Each adapter (Claude Agent SDK in apps/agents, MCP SDK in
 * packages/mcp, etc.) iterates this array and wraps each
 * `LeashTool` definition in its surface-specific tool() call.
 */

import type { LeashTool } from '../tool.js';

import { createPaymentLinkTool } from './create-payment-link.js';
import { payPaymentLinkTool } from './pay-payment-link.js';
import { checkBalancesTool } from './check-balances.js';
import { withdrawTreasuryTool } from './withdraw-treasury.js';
import { registerAgentTool } from './register-agent.js';
import { getIdentityTool } from './get-identity.js';
import { receiptsTool } from './receipts.js';
import { discoverTool } from './discover.js';
import { reputationTool } from './reputation.js';
import { setSpendLimitTool } from './set-spend-limit.js';
import { getSpendLimitTool } from './get-spend-limit.js';
import { getReceiptTool } from './get-receipt.js';
import { transactionHistoryTool } from './transaction-history.js';
import { dailyTransactionsTool } from './daily-transactions.js';

export {
  createPaymentLinkTool,
  payPaymentLinkTool,
  checkBalancesTool,
  withdrawTreasuryTool,
  registerAgentTool,
  getIdentityTool,
  receiptsTool,
  discoverTool,
  reputationTool,
  setSpendLimitTool,
  getSpendLimitTool,
  getReceiptTool,
  transactionHistoryTool,
  dailyTransactionsTool,
};

/** Stable alphabetical export order so tools/list output is deterministic. */
export const LEASH_TOOLS: ReadonlyArray<LeashTool> = [
  checkBalancesTool,
  createPaymentLinkTool,
  dailyTransactionsTool,
  discoverTool,
  getIdentityTool,
  getReceiptTool,
  getSpendLimitTool,
  payPaymentLinkTool,
  receiptsTool,
  registerAgentTool,
  reputationTool,
  setSpendLimitTool,
  transactionHistoryTool,
  withdrawTreasuryTool,
];
