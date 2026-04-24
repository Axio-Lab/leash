/**
 * Server-side configuration for `@leash/api`.
 *
 * Everything that varies between local dev / staging / prod lives here so
 * the rest of the app can stay environment-agnostic. We intentionally
 * resolve config eagerly (`createConfig()` reads `process.env` once) so
 * misconfigurations die at startup, not on the first request.
 */

import type { SvmNetwork } from './util/network.js';

/** Public, advertised semver of the API surface. Bumped by hand on contract changes. */
export const LEASH_API_VERSION = '0.1.0';

export type LeashApiConfig = {
  host: string;
  port: number;
  /**
   * Map of network -> RPC URL. Both networks always have an entry; the
   * caller's API key prefix selects which one is used per-request.
   */
  rpc: Record<SvmNetwork, string>;
  db: {
    url: string;
    authToken?: string;
  };
  /** `null` means "no Redis configured" — the in-memory fallbacks kick in. */
  redisUrl: string | null;
  /** Per-key requests-per-minute ceiling. Default 120 RPM. */
  rateLimitRpm: number;
  /**
   * Optional bootstrap key. When set, the first start of the server
   * registers this exact key against `lsh_test_` (devnet) or `lsh_live_`
   * (mainnet) based on prefix. Useful for local dev only.
   */
  bootstrapKey?: { value: string; label: string };
  /**
   * Long random string that gates the `/v1/admin/*` surface. When unset
   * those routes are not mounted at all (no admin endpoints exist),
   * so a misconfigured deploy can never accidentally expose key
   * issuance. Must be at least 32 chars.
   */
  adminSecret?: string;
  /**
   * When `true`, the server mounts `/docs` (Swagger UI) and a `/` →
   * `/docs` redirect. Default: `true` if `NODE_ENV !== 'production'`,
   * `false` otherwise. Override with `LEASH_API_DOCS_ENABLED=true|false`.
   */
  docsEnabled: boolean;
};

function readEnv(key: string, fallback: string): string {
  const v = process.env[key];
  return v == null || v.length === 0 ? fallback : v;
}

function readNumber(key: string, fallback: number): number {
  const v = process.env[key];
  if (v == null || v.length === 0) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${key}: expected a positive number, got "${v}"`);
  }
  return n;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.length === 0) return fallback;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

const MIN_ADMIN_SECRET_LEN = 24;

export function createConfig(env: NodeJS.ProcessEnv = process.env): LeashApiConfig {
  const bootstrapKey = env.LEASH_API_BOOTSTRAP_KEY?.trim();
  const adminSecretRaw = env.LEASH_API_ADMIN_SECRET?.trim();
  if (adminSecretRaw && adminSecretRaw.length < MIN_ADMIN_SECRET_LEN) {
    throw new Error(
      `LEASH_API_ADMIN_SECRET: must be >= ${MIN_ADMIN_SECRET_LEN} chars; got ${adminSecretRaw.length}`,
    );
  }
  const docsDefault = env.NODE_ENV !== 'production';
  return {
    host: readEnv('LEASH_API_HOST', '0.0.0.0'),
    port: readNumber('LEASH_API_PORT', 8801),
    rpc: {
      'solana-devnet': readEnv('LEASH_API_RPC_DEVNET', 'https://api.devnet.solana.com'),
      'solana-mainnet': readEnv('LEASH_API_RPC_MAINNET', 'https://api.mainnet-beta.solana.com'),
    },
    db: {
      url: readEnv('LEASH_API_DB_URL', 'file:./.leash-api.db'),
      ...(env.LEASH_API_DB_AUTH_TOKEN ? { authToken: env.LEASH_API_DB_AUTH_TOKEN } : {}),
    },
    redisUrl: env.LEASH_API_REDIS_URL?.trim() || null,
    rateLimitRpm: readNumber('LEASH_API_RATELIMIT_RPM', 120),
    docsEnabled: readBool(env.LEASH_API_DOCS_ENABLED, docsDefault),
    ...(adminSecretRaw ? { adminSecret: adminSecretRaw } : {}),
    ...(bootstrapKey
      ? {
          bootstrapKey: {
            value: bootstrapKey,
            label: env.LEASH_API_BOOTSTRAP_KEY_LABEL ?? 'bootstrap',
          },
        }
      : {}),
  };
}

/**
 * Map a key prefix back to the network it controls. Throws on unknown
 * prefixes so misconfigured callers get an early, clear failure.
 */
export function networkFromKey(key: string): SvmNetwork {
  if (key.startsWith('lsh_test_')) return 'solana-devnet';
  if (key.startsWith('lsh_live_')) return 'solana-mainnet';
  throw new Error(
    `unknown api key prefix; expected lsh_test_* (devnet) or lsh_live_* (mainnet), got "${key.slice(0, 12)}…"`,
  );
}
