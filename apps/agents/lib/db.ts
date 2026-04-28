import { createClient, type Client } from '@libsql/client';

import { getServerEnv } from './env';

let cached: Client | null = null;

/**
 * Returns the shared libsql client used by every server route. Lazy so
 * we don't open a connection at module import time during builds.
 */
export function getDb(): Client {
  if (cached) return cached;
  const env = getServerEnv();
  cached = createClient({
    url: env.leashDbUrl,
    ...(env.leashDbAuthToken ? { authToken: env.leashDbAuthToken } : {}),
  });
  return cached;
}
