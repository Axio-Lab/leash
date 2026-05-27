/**
 * Canonical list of Leash MCP tools shared across every host
 * (chat product, standalone STDIO MCP, CLI, future surfaces).
 *
 * Each adapter (Claude Agent SDK in apps/agents, MCP SDK in
 * packages/mcp, etc.) iterates this array and wraps each
 * `LeashTool` definition in its surface-specific tool() call.
 */

import type { LeashTool } from '../tool.js';

import { createAgentApiKeyTool } from './create-agent-api-key.js';
import { createIdentityClaimTool } from './create-identity-claim.js';
import { createIdentityDisclosureTool } from './create-identity-disclosure.js';
import { createPaymentLinkTool } from './create-payment-link.js';
import { checkBalancesTool } from './check-balances.js';
import { dailyTransactionsTool } from './daily-transactions.js';
import { discoverTool } from './discover.js';
import { getIdentityProfileTool } from './get-identity-profile.js';
import { getIdentityTool } from './get-identity.js';
import { getReceiptTool } from './get-receipt.js';
import { getSpendLimitTool } from './get-spend-limit.js';
import { listAgentApiKeysTool } from './list-agent-api-keys.js';
import { listIdentityDisclosuresTool } from './list-identity-disclosures.js';
import { payPaymentLinkTool } from './pay-payment-link.js';
import { paySkillsEndpointsTool } from './pay-skills-endpoints.js';
import { receiptsTool } from './receipts.js';
import { registerAgentTool } from './register-agent.js';
import { reputationTool } from './reputation.js';
import { resolveIdentityTool } from './resolve-identity.js';
import { revokeAgentApiKeyTool } from './revoke-agent-api-key.js';
import { revokeIdentityClaimTool } from './revoke-identity-claim.js';
import { revokeIdentityDisclosureTool } from './revoke-identity-disclosure.js';
import { setSpendLimitTool } from './set-spend-limit.js';
import { transactionHistoryTool } from './transaction-history.js';
import { updateIdentityProfileTool } from './update-identity-profile.js';
import { verifyIdentityTool } from './verify-identity.js';
import { verifyIdentityDomainTool } from './verify-identity-domain.js';
import { withdrawTreasuryTool } from './withdraw-treasury.js';

export {
  checkBalancesTool,
  createAgentApiKeyTool,
  createIdentityClaimTool,
  createIdentityDisclosureTool,
  createPaymentLinkTool,
  dailyTransactionsTool,
  discoverTool,
  getIdentityProfileTool,
  getIdentityTool,
  getReceiptTool,
  getSpendLimitTool,
  listAgentApiKeysTool,
  listIdentityDisclosuresTool,
  payPaymentLinkTool,
  paySkillsEndpointsTool,
  receiptsTool,
  registerAgentTool,
  reputationTool,
  resolveIdentityTool,
  revokeAgentApiKeyTool,
  revokeIdentityClaimTool,
  revokeIdentityDisclosureTool,
  setSpendLimitTool,
  transactionHistoryTool,
  updateIdentityProfileTool,
  verifyIdentityTool,
  verifyIdentityDomainTool,
  withdrawTreasuryTool,
};

/** Stable alphabetical export order so tools/list output is deterministic. */
export const LEASH_TOOLS: ReadonlyArray<LeashTool> = [
  checkBalancesTool,
  createAgentApiKeyTool,
  createIdentityClaimTool,
  createIdentityDisclosureTool,
  createPaymentLinkTool,
  dailyTransactionsTool,
  discoverTool,
  getIdentityTool,
  getIdentityProfileTool,
  getReceiptTool,
  getSpendLimitTool,
  listAgentApiKeysTool,
  listIdentityDisclosuresTool,
  payPaymentLinkTool,
  paySkillsEndpointsTool,
  receiptsTool,
  registerAgentTool,
  reputationTool,
  resolveIdentityTool,
  revokeAgentApiKeyTool,
  revokeIdentityClaimTool,
  revokeIdentityDisclosureTool,
  setSpendLimitTool,
  transactionHistoryTool,
  updateIdentityProfileTool,
  verifyIdentityTool,
  verifyIdentityDomainTool,
  withdrawTreasuryTool,
];
