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

export {
  createPaymentLinkTool,
  payPaymentLinkTool,
  checkBalancesTool,
  withdrawTreasuryTool,
  registerAgentTool,
  getIdentityTool,
  receiptsTool,
};

/** Stable alphabetical export order so tools/list output is deterministic. */
export const LEASH_TOOLS: ReadonlyArray<LeashTool> = [
  checkBalancesTool,
  createPaymentLinkTool,
  getIdentityTool,
  payPaymentLinkTool,
  receiptsTool,
  registerAgentTool,
  withdrawTreasuryTool,
];
