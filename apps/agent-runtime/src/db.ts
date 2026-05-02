import { createClient, type Client } from '@libsql/client';

import { getEnv } from './env.js';

let cached: Client | null = null;

export function getDb(): Client {
  if (cached) return cached;
  const env = getEnv();
  cached = createClient({
    url: env.dbUrl,
    ...(env.dbAuthToken ? { authToken: env.dbAuthToken } : {}),
  });
  return cached;
}
