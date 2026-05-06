/**
 * `@leashmarket/platform-auth`
 *
 * Shared helpers for the two Next.js surfaces (`apps/agents`,
 * `apps/marketplace`):
 *
 *   - Verify a Privy access token / cookie and resolve it into a
 *     `PrivySession` (id + wallet + email).
 *   - Upsert a row in the platform `users` table so we have a stable
 *     point-of-truth that joins to `api_keys.owner_wallet` for ops.
 *   - Provide a typed client for `apps/api`'s admin endpoints so the
 *     BFFs can issue / list / revoke `lsh_*` keys without each surface
 *     re-implementing fetch + error handling.
 *
 * Privy verification uses `@privy-io/server-auth`. Surfaces should pass
 * the Privy access token from the `privy-token` cookie (set by the
 * client SDK) or the `Authorization: Bearer <token>` header for direct
 * server-to-server calls.
 */

export {
  verifyPrivyJwt,
  verifyPrivyJwtDetailed,
  peekPrivyJwt,
  type PrivySession,
  type PrivyVerifierOptions,
  type PrivyVerifyResult,
  type PrivyVerifyStatus,
  type DecodedJwtPeek,
} from './privy.js';
export { getOrCreateUser, getUser, type PlatformUser, type PlatformDbClient } from './users.js';
export {
  recordPlatformKey,
  listPlatformKeys,
  removePlatformKey,
  type PlatformKeyRow,
} from './platform-keys.js';
export {
  createLeashAdminClient,
  type LeashAdminClient,
  type LeashApiKeyRecord,
  type CreateApiKeyArgs,
  type ApiScope,
  LeashAdminError,
} from './leash-client.js';
export { encryptSecret, decryptSecret } from './encryption.js';
