/**
 * `@leash/mcp-core` — host-agnostic core for every Leash MCP surface.
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
  CreatePaymentLinkArgs,
  PayArgs,
  WithdrawArgs,
  CheckTreasuryBalanceArgs,
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
  createPaymentLinkTool,
  payPaymentLinkTool,
  withdrawTreasuryTool,
} from './tools/index.js';

export {
  isLikelyBase58Address,
  lookupTokenBySymbolSafe,
  decodeBase64Json,
  probePaymentLink,
  type TokenMeta,
  type TokenProgramId,
  type PaymentRequirementPreview,
} from './helpers/index.js';
