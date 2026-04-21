/**
 * Kill-switch helpers (env + on-chain).
 *
 * The on-chain mechanism (per LEASH plan §7.5) is a `paused: bool` stored in
 * the AppData plugin on the Core asset, owner-only writable via
 * `updatePluginV1`. Reading that plugin requires an mpl-core-aware resolver
 * (provided by the runner / app), so this module exposes a small generic
 * cached wrapper plus the env breaker.
 */
export type PauseState = { paused: boolean; source: 'env' | 'onchain' | 'cache' };

export function readPauseFromEnv(): boolean {
  return process.env.LEASH_KILL === '1';
}

export type PauseResolverOptions = {
  /** Async function returning the current on-chain `paused` flag for the asset. */
  fetchOnchainPaused?: () => Promise<boolean>;
  /** Cache TTL in milliseconds (default 5000 — keeps RPC pressure low per plan). */
  cacheTtlMs?: number;
  /** Clock override for tests. */
  now?: () => number;
};

/**
 * Returns a function the runner can call before any outbound HTTP. Honors
 * env breaker first (returns immediately), otherwise consults the on-chain
 * resolver with a TTL cache. Failures fall back to the last-known value if
 * present, else `false` (fail-open is intentional for v0.1: an RPC outage
 * should not silently stall the agent — operators can set `LEASH_KILL=1` for
 * hard stop).
 */
export function createPauseResolver(opts: PauseResolverOptions = {}): () => Promise<PauseState> {
  const ttl = opts.cacheTtlMs ?? 5000;
  const now = opts.now ?? Date.now;
  let last: { value: boolean; ts: number } | null = null;

  return async function resolve(): Promise<PauseState> {
    if (readPauseFromEnv()) {
      return { paused: true, source: 'env' };
    }
    if (!opts.fetchOnchainPaused) {
      return { paused: false, source: 'onchain' };
    }
    const t = now();
    if (last && t - last.ts < ttl) {
      return { paused: last.value, source: 'cache' };
    }
    try {
      const value = await opts.fetchOnchainPaused();
      last = { value, ts: t };
      return { paused: value, source: 'onchain' };
    } catch {
      if (last) {
        return { paused: last.value, source: 'cache' };
      }
      return { paused: false, source: 'onchain' };
    }
  };
}
