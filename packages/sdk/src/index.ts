/**
 * `@leashmarket/sdk` — typed Leash API client.
 *
 *   import { LeashClient } from '@leashmarket/sdk';
 *
 *   const leash = new LeashClient({ baseUrl: 'https://api.leash.market' });
 *   const services = await leash.discover({ capability: 'ocr' });
 *   const rep = await leash.reputation({ agentMint: services.items[0].seller_agent_mint! });
 *
 * Browser/Bun/Deno friendly — uses `fetch` + `globalThis.crypto.subtle`
 * with a Node `node:crypto` fallback. No process/fs imports at module
 * load time.
 */

export { LeashClient, LeashError, type LeashClientOptions } from './client.js';
export { signRequest, buildEnvelope, type SigningHeaders, type SigningEnvelope } from './sign.js';

export type {
  AgentApiKey,
  AgentWebhook,
  AgentWebhookWithSecret,
  CreateAgentApiKeyInput,
  CreateAgentApiKeyResponse,
  DailyTransactionsResponse,
  DailyTxBucket,
  DiscoverItem,
  DiscoverResponse,
  EndpointMethod,
  IdentityCapabilityCard,
  IdentityClaim,
  IdentityDisclosureCreateResponse,
  IdentityDisclosureGrant,
  IdentityDisclosureRead,
  IdentityDisclosureResource,
  IdentitySelector,
  IdentityVerificationDecision,
  IdentityVerificationDecisionRequest,
  IdentityVerificationThresholds,
  IdentityVerifyResponse,
  LeashFeeExtra,
  OperatorHistoryEntry,
  PaymentLink,
  PaymentLinkAcceptsEntry,
  PaymentLinkCreateInput,
  PaymentLinkPatchInput,
  PaymentLinkResponseTemplate,
  PaymentLinksListResponse,
  ListAgentApiKeysResponse,
  PublicIdentityProfile,
  Receipt,
  ReceiptsResponse,
  RecordAgentInput,
  RecordAgentResponse,
  ReputationSnapshot,
  StableSymbol,
  SvmNetwork,
  TransactionHistoryItem,
  TransactionHistoryResponse,
} from './types.js';

export const LEASH_SDK_VERSION = '0.3.2';
