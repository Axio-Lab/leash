export type RuntimeEnv = {
  dbUrl: string;
  dbAuthToken: string | undefined;
  redisUrl: string | undefined;
  encryptionKey: string;
  pollMs: number;
};

let cached: RuntimeEnv | null = null;

export function getEnv(): RuntimeEnv {
  if (cached) return cached;
  const get = (n: string): string => {
    const v = process.env[n];
    if (!v || v.length === 0) throw new Error(`missing env: ${n}`);
    return v;
  };
  cached = {
    dbUrl: get('LEASH_DB_URL'),
    dbAuthToken: process.env.LEASH_DB_AUTH_TOKEN,
    redisUrl: process.env.LEASH_REDIS_URL,
    encryptionKey: get('ENCRYPTION_KEY'),
    pollMs: Number.parseInt(process.env.LEASH_RUNTIME_POLL_MS ?? '750', 10) || 750,
  };
  return cached;
}

export function _resetEnvForTests(): void {
  cached = null;
}
