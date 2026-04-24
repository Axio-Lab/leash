/**
 * Public entrypoint of the `@leash/api` server. Re-exports the app
 * factory plus the few helpers callers might want for embedding (tests,
 * bespoke deployments, in-process integration).
 */

export { createLeashApiApp, type CreateLeashApiArgs } from './server.js';
export { createConfig, networkFromKey, LEASH_API_VERSION } from './config.js';
export type { LeashApiConfig } from './config.js';
export { boot } from './bootstrap.js';
export { getDb, runMigrations, _resetDbForTests } from './storage/turso.js';
export { getCache, _resetCacheForTests } from './storage/redis.js';
export {
  createApiKey,
  generateApiKey,
  getApiKeyByPlaintext,
  type ApiKeyRecord,
  type CreateApiKeyResult,
} from './storage/api-keys.js';
export type { EventKind, EventPhase, EventRow } from './storage/events.js';
export type { SvmNetwork } from './util/network.js';
