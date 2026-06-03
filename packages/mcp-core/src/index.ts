/**
 * `@leashmarket/mcp-core` — host-agnostic core for every Leash MCP surface.
 *
 * What lives here
 * ---------------
 *   - `LeashHost`     : runtime contract every host implements
 *   - `LeashTool`     : tool-definition primitive (name, schema, handler)
 *   - `LEASH_TOOLS`   : the canonical tool list adapters iterate
 *   - `helpers/*`     : pure utilities (probe, address-shape, token catalog)
 *
 * What does NOT live here
 * -----------------------
 * Anything that takes a hard dep on a specific runtime (Claude Agent
 * SDK, `@modelcontextprotocol/sdk`, Node-only modules, browser-only
 * modules). Adapters glue this package to those runtimes.
 */

export type {
  LeashHost,
  SvmNetwork,
  StableSymbol,
  WithdrawableToken,
  CreateAgentApiKeyArgs,
  CreatePaymentLinkArgs,
  ListAgentApiKeysArgs,
  PayArgs,
  RevokeAgentApiKeyArgs,
  WithdrawArgs,
  CheckTreasuryBalanceArgs,
  RegisterAgentArgs,
  GetIdentityArgs,
  GetIdentityProfileArgs,
  UpdateIdentityProfileArgs,
  VerifyIdentityDomainArgs,
  CreateIdentityClaimArgs,
  RevokeIdentityClaimArgs,
  ListIdentityDisclosuresArgs,
  CreateIdentityDisclosureArgs,
  RevokeIdentityDisclosureArgs,
  IdentitySelectorArgs,
  IdentityVerifyArgs,
  ReceiptsArgs,
  DiscoverArgs,
  PaySkillsProviderArgs,
  ReputationArgs,
  SetSpendLimitArgs,
  GetSpendLimitArgs,
  NativeSubscriptionsArgs,
  GetReceiptArgs,
  TransactionHistoryArgs,
  DailyTransactionsArgs,
} from './host.js';

export {
  defineTool,
  jsonResult,
  noAgentResult,
  type LeashTool,
  type LeashToolResult,
} from './tool.js';

export {
  LEASH_TOOLS,
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
  nativeSubscriptionsTool,
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
} from './tools/index.js';

export {
  isLikelyBase58Address,
  lookupTokenBySymbolSafe,
  symbolForMintSafe,
  decodeBase64Json,
  probePaymentLink,
  fetchDiscover,
  fetchIdentityProfile,
  fetchIdentityVerify,
  fetchPaySkillsProvider,
  fetchReputation,
  type TokenMeta,
  type TokenProgramId,
  type PaymentRequirementPreview,
  type DiscoverItem,
  type DiscoverSource,
  type IdentityVerifyResponse,
  type IdentityVerificationDecision,
  type OperatorHistoryEntry,
  type PaySkillsEndpoint,
  type PaySkillsProvider,
  type PublicIdentityProfile,
  type ReputationSnapshot,
} from './helpers/index.js';
