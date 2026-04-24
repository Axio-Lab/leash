/**
 * Public entrypoint of the `@leash/api` server. Re-exports the app
 * factory plus the few helpers callers might want for embedding (tests,
 * bespoke deployments, in-process integration with sister apps such as
 * the Leash Explorer).
 *
 * The explorer is a Next.js app that reads from the same Turso DB and
 * Solana RPC the API uses, and imports these helpers directly to avoid
 * an HTTP hop. Anything below is part of that internal-infra surface;
 * external SDK users go through HTTP, not these exports.
 */

export { createLeashApiApp, type CreateLeashApiArgs } from './server.js';
export { createConfig, networkFromKey, LEASH_API_VERSION } from './config.js';
export type { LeashApiConfig } from './config.js';
export { boot } from './bootstrap.js';
export { getDb, runMigrations, _resetDbForTests } from './storage/turso.js';
export type { DbClient } from './storage/turso.js';
export { getCache, _resetCacheForTests } from './storage/redis.js';
export {
  createApiKey,
  generateApiKey,
  getApiKeyByPlaintext,
  type ApiKeyRecord,
  type CreateApiKeyResult,
} from './storage/api-keys.js';

// --- read-side helpers re-used by the internal explorer -------------

export {
  listEvents,
  getEventById,
  listEventsForSignature,
  type EventKind,
  type EventPhase,
  type EventRow,
  type ListEventsArgs,
} from './storage/events.js';
export {
  listReceipts,
  getReceiptByHash,
  type ReceiptRow,
  type ListReceiptsArgs,
} from './storage/receipts.js';
export { getIndexerStatus, type IndexerStatus } from './storage/indexer-status.js';
export {
  getAgentSummary,
  getAgentTreasuryBalances,
  getAgentSnapshot,
  type AgentSummary,
  type AgentTreasuryBalances,
  type AgentSnapshot,
  type AgentSplBalance,
  type AgentIdentitySource,
} from './util/agent-snapshot.js';
export { umiReadOnly } from './util/umi.js';
export {
  isSvmNetwork,
  networkLabel,
  networkToCaip2,
  SVM_NETWORKS,
  type SvmNetwork,
} from './util/network.js';
