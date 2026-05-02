/**
 * `@leash/sdk` — typed Leash API client.
 *
 *   import { LeashClient } from '@leash/sdk';
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
  AgentWebhook,
  AgentWebhookWithSecret,
  DailyTransactionsResponse,
  DailyTxBucket,
  DiscoverItem,
  DiscoverResponse,
  EndpointMethod,
  LeashFeeExtra,
  PaymentLink,
  PaymentLinkAcceptsEntry,
  PaymentLinkCreateInput,
  PaymentLinkPatchInput,
  PaymentLinkResponseTemplate,
  PaymentLinksListResponse,
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

export const LEASH_SDK_VERSION = '0.1.0';
