import { createLeashAdminClient, type LeashAdminClient } from '@leash/platform-auth/leash-client';

import { getServerEnv } from './env';

let cached: LeashAdminClient | null = null;

/**
 * Returns the typed Leash admin client used by every BFF route to
 * issue / list / revoke `lsh_*` keys (and call the agents/tasks/listings
 * routes added later in Phase 1+2).
 */
export function getLeash(): LeashAdminClient {
  if (cached) return cached;
  const env = getServerEnv();
  cached = createLeashAdminClient({
    baseUrl: env.leashApiUrl,
    adminSecret: env.leashApiAdminSecret,
  });
  return cached;
}
