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

export { createPaymentLinkTool, payPaymentLinkTool, checkBalancesTool, withdrawTreasuryTool };

/** Stable alphabetical export order so tools/list output is deterministic. */
export const LEASH_TOOLS: ReadonlyArray<LeashTool> = [
  checkBalancesTool,
  createPaymentLinkTool,
  payPaymentLinkTool,
  withdrawTreasuryTool,
];
