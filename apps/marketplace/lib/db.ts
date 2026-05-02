import { createClient, type Client } from '@libsql/client';

import { getServerEnv } from './env';

let cached: Client | null = null;

export function getDb(): Client {
  if (cached) return cached;
  const env = getServerEnv();
  cached = createClient({
    url: env.leashDbUrl,
    ...(env.leashDbAuthToken ? { authToken: env.leashDbAuthToken } : {}),
  });
  return cached;
}
