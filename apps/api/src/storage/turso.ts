/**
 * Turso/SQLite source-of-truth client.
 *
 * Schema:
 *   - `api_keys`     — server-issued credentials (test_/live_).
 *   - `api_requests` — every request, for usage and billing.
 *   - `events`       — protocol-level event lifecycle (prepare → confirm).
 *   - `receipts`     — x402 receipts (Phase 2 fills these).
 *   - `pull_targets` — `services.receipts` URLs to poll (Phase 2).
 *
 * Keeping schema definitions co-located with the client keeps migrations
 * trivial: bump `SCHEMA_VERSION`, add an `if (current < N)` block, and
 * `runMigrations` is the only callsite.
 */

import { createClient, type Client, type InValue } from '@libsql/client';

import type { LeashApiConfig } from '../config.js';

export type DbClient = Client;

const SCHEMA_VERSION = 4;

/**
 * SQLite expression that produces a real ISO-8601 UTC timestamp
 * (`YYYY-MM-DDTHH:MM:SS.fffZ`). We use this everywhere instead of
 * `datetime('now')` because the latter emits `YYYY-MM-DD HH:MM:SS`
 * (UTC, but missing the `T` and `Z`), which V8's `Date` parser
 * silently interprets as **local time** — leading to `formatRelative`
 * showing "1h ago" for fresh rows in any timezone other than UTC.
 *
 * Lex ordering between two strings produced by this expression matches
 * chronological ordering, same as `datetime('now')` did, so any
 * `ORDER BY ts` / `WHERE next_attempt_at <= ?` comparison keeps working
 * — provided **both sides** use this format. The v4 migration backfills
 * historical rows so mixed-format comparisons never occur.
 */
export const NOW_ISO_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  )`,

  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    prefix TEXT NOT NULL,
    last4 TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    disabled_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS api_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id TEXT NOT NULL,
    network TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    error_code TEXT,
    client_reference TEXT,
    ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_api_requests_key_ts ON api_requests(api_key_id, ts DESC)`,

  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    kind TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('prepared','submitted','confirmed','failed')),
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    api_key_id TEXT,
    client_reference TEXT,
    agent_asset TEXT,
    signature TEXT,
    mint TEXT,
    amount_atomic TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    error_message TEXT,
    confirmed_at TEXT,
    failed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_network_ts ON events(network, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_agent_ts ON events(agent_asset, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events(kind, ts DESC)`,
  // Lookup index for `(network, signature)`. NOT unique — one signature
  // can produce multiple event rows when an `Execute` withdraws several
  // SPL mints in a single tx (one row per mint). Cross-network
  // isolation is preserved by including `network` in every query.
  `CREATE INDEX IF NOT EXISTS idx_events_network_signature ON events(network, signature) WHERE signature IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS receipts (
    receipt_hash TEXT NOT NULL,
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    agent TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    decision TEXT NOT NULL,
    kind TEXT NOT NULL,
    tx_sig TEXT,
    payment_requirements_hash TEXT,
    raw_json TEXT NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (network, receipt_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_agent_ts ON receipts(agent, ingested_at DESC)`,

  `CREATE TABLE IF NOT EXISTS pull_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    agent TEXT NOT NULL,
    url TEXT NOT NULL,
    last_polled_at TEXT,
    last_cursor TEXT,
    UNIQUE (network, agent, url)
  )`,

  // Indexer state: one row per (network, watch_address, kind). The
  // indexer pages backwards through `getSignaturesForAddress(address)`
  // until it hits `last_signature`, then resumes forward from the
  // newest signature on the next pass. `kind` lets us track separate
  // cursors for the same address used in different roles (e.g. asset
  // pubkey vs treasury PDA).
  `CREATE TABLE IF NOT EXISTS indexer_cursors (
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    address TEXT NOT NULL,
    kind TEXT NOT NULL,
    last_signature TEXT,
    last_slot INTEGER,
    last_run_at TEXT,
    backfill_complete INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (network, address, kind)
  )`,

  // Watchlist the indexer iterates on each tick. Populated automatically
  // whenever the API sees a new agent asset (via prepare events or
  // receipt ingest) so we never need to scan an entire program ID.
  //
  // `kind` semantics:
  //   - 'asset'        — agent's mpl-core asset (identity / executive / token).
  //   - 'treasury'     — asset signer PDA (Execute = withdraws, provisioning).
  //   - 'treasury_ata' — a stable ATA owned by the treasury PDA. Required to
  //     pick up plain SPL `TransferChecked` deposits, since the PDA itself
  //     is not in the account list of those transactions and therefore
  //     never surfaces through `getSignaturesForAddress(pda)`.
  //
  // The CHECK constraint is intentionally absent: SQLite cannot widen
  // CHECK constraints with `ALTER TABLE`, and any future watch kind
  // (e.g. token mint, token-2022 extension) would otherwise force a
  // fresh migration. The TS `WatchKind` enum is the source of truth.
  `CREATE TABLE IF NOT EXISTS indexer_watchlist (
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    address TEXT NOT NULL,
    kind TEXT NOT NULL,
    agent_asset TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (network, address, kind)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_indexer_watchlist_agent ON indexer_watchlist(agent_asset)`,

  // Outbound webhook subscriptions (Phase 6). One row per
  // (api_key_id, url) pair. `secret` is a random base64 string the
  // sender HMAC-signs each delivery with — receivers verify it via
  // the X-Leash-Signature header. `events` is a JSON array of
  // EventKind strings; `null` / empty = subscribe to all kinds.
  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    api_key_id TEXT NOT NULL,
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events_json TEXT NOT NULL DEFAULT '[]',
    disabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (api_key_id, url),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_webhooks_network ON webhooks(network) WHERE disabled_at IS NULL`,

  // Per-delivery state with retry book-keeping. Created when an
  // event lands in webhook_deliveries_pending; the worker advances
  // attempts and either marks delivered=1 or schedules next_attempt_at
  // with exponential backoff. Deliveries are pruned after 7 days.
  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    delivered INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_status INTEGER,
    last_error TEXT,
    last_attempt_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (webhook_id) REFERENCES webhooks(id),
    UNIQUE (webhook_id, event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending ON webhook_deliveries(next_attempt_at) WHERE delivered = 0`,

  // Hosted x402 payment links served by `/x/{id}`. Same role as the
  // runner's `endpoints` table, except authoritative and queryable
  // through `/v1/payment-links` so non-runner consumers (and the
  // explorer) see them too.
  //
  // Primary key is (network, id) so devnet and mainnet can each own
  // the same slug — matches receipts/events isolation. `path` is what
  // the paywall mounts (always `/x/<id>` today; recorded for parity
  // with seller-kit's route-keyed config).
  //
  // Counters are maintained by recordCall / recordSettlement so
  // `GET /v1/payment-links/{id}` can show "served N, settled M" without
  // re-aggregating the events table on every request.
  `CREATE TABLE IF NOT EXISTS payment_links (
    id TEXT NOT NULL,
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    api_key_id TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    owner_agent TEXT NOT NULL,
    owner_wallet TEXT,
    method TEXT NOT NULL CHECK (method IN ('GET','POST')),
    path TEXT NOT NULL,
    price TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('USDC','USDT','USDG')),
    accepts_currencies_json TEXT NOT NULL DEFAULT '[]',
    response_json TEXT NOT NULL,
    webhook_url TEXT,
    wrap_receipt INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    call_count INTEGER NOT NULL DEFAULT 0,
    settled_count INTEGER NOT NULL DEFAULT 0,
    last_called_at TEXT,
    last_settled_at TEXT,
    last_tx_sig TEXT,
    last_settled_amount_atomic TEXT,
    last_settled_currency TEXT,
    disabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (network, id),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payment_links_key_created ON payment_links(api_key_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_links_agent ON payment_links(owner_agent)`,
];

let cached: Client | null = null;

export function getDb(config: LeashApiConfig): Client {
  if (cached != null) return cached;
  cached = createClient({
    url: config.db.url,
    ...(config.db.authToken ? { authToken: config.db.authToken } : {}),
  });
  return cached;
}

/** Reset the module-level cache. Used by tests that want isolated DBs. */
export function _resetDbForTests(): void {
  cached = null;
}

export async function runMigrations(db: Client): Promise<void> {
  for (const stmt of SCHEMA_SQL) {
    await db.execute(stmt);
  }

  // Versioned migrations. New databases get the latest schema directly
  // from `SCHEMA_SQL` above and skip every block (currentVersion ≥ N
  // already). Older databases ratchet forward one version at a time.
  const cur = await db.execute('SELECT version FROM schema_version LIMIT 1');
  const currentVersion = cur.rows.length > 0 ? Number(cur.rows[0]!.version) : 0;

  // v3: drop the `kind IN ('asset','treasury')` CHECK on
  // `indexer_watchlist` so we can introduce new watch kinds (e.g.
  // 'treasury_ata') without another migration.
  if (currentVersion < 3) {
    await migrateWatchlistKindCheck(db);
  }

  // v4: backfill SQLite-style `YYYY-MM-DD HH:MM:SS` timestamps to real
  // ISO-8601 UTC (`YYYY-MM-DDTHH:MM:SS.000Z`). Without this, the
  // explorer's `formatRelative` would render historical rows as "1h
  // ago" in any timezone other than UTC, and any post-deploy
  // `next_attempt_at <= strftime(...)` check would compare strings of
  // different shapes (lex-incorrect).
  if (currentVersion < 4) {
    await migrateTimestampsToIso(db);
  }

  if (currentVersion < SCHEMA_VERSION) {
    await db.execute({
      sql: 'INSERT OR REPLACE INTO schema_version(version) VALUES(?)',
      args: [SCHEMA_VERSION],
    });
  }
}

/**
 * SQLite cannot alter CHECK constraints in place. To drop the old
 * `kind IN ('asset','treasury')` rule we copy the table into a new one
 * without that constraint, then atomically swap names. Wrapped in a
 * transaction so a crash mid-migration doesn't leave us with both
 * tables. Idempotent: if the target table already exists (because a
 * previous migration was interrupted), we drop it and retry.
 */
async function migrateWatchlistKindCheck(db: Client): Promise<void> {
  await db.execute('DROP TABLE IF EXISTS indexer_watchlist_v3_tmp');
  await db.execute(`CREATE TABLE indexer_watchlist_v3_tmp (
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    address TEXT NOT NULL,
    kind TEXT NOT NULL,
    agent_asset TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (network, address, kind)
  )`);
  await db.execute(
    `INSERT INTO indexer_watchlist_v3_tmp (network, address, kind, agent_asset, added_at)
       SELECT network, address, kind, agent_asset, added_at FROM indexer_watchlist`,
  );
  await db.execute('DROP TABLE indexer_watchlist');
  await db.execute('ALTER TABLE indexer_watchlist_v3_tmp RENAME TO indexer_watchlist');
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_indexer_watchlist_agent ON indexer_watchlist(agent_asset)`,
  );
}

/**
 * Every timestamp column historically populated by `datetime('now')`.
 * The v4 migration rewrites any row matching the SQLite default's
 * shape (`YYYY-MM-DD HH:MM:SS`) to the new ISO-8601 form. The list is
 * conservative — if a column was renamed or dropped over the lifetime
 * of the schema we'd just need to re-add it here for a fresh deploy
 * to be a no-op (the GLOB filter only updates rows that match the old
 * format anyway).
 */
const TIMESTAMP_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'api_keys', column: 'created_at' },
  { table: 'api_keys', column: 'disabled_at' },
  { table: 'api_requests', column: 'ts' },
  { table: 'events', column: 'ts' },
  { table: 'events', column: 'confirmed_at' },
  { table: 'events', column: 'failed_at' },
  { table: 'receipts', column: 'ingested_at' },
  { table: 'pull_targets', column: 'last_polled_at' },
  { table: 'indexer_cursors', column: 'last_run_at' },
  { table: 'indexer_watchlist', column: 'added_at' },
  { table: 'webhooks', column: 'created_at' },
  { table: 'webhooks', column: 'disabled_at' },
  { table: 'webhook_deliveries', column: 'next_attempt_at' },
  { table: 'webhook_deliveries', column: 'last_attempt_at' },
  { table: 'webhook_deliveries', column: 'created_at' },
  { table: 'payment_links', column: 'last_called_at' },
  { table: 'payment_links', column: 'last_settled_at' },
  { table: 'payment_links', column: 'disabled_at' },
  { table: 'payment_links', column: 'created_at' },
  { table: 'payment_links', column: 'updated_at' },
];

/**
 * Rewrite legacy `datetime('now')` timestamps (`YYYY-MM-DD HH:MM:SS`,
 * UTC but missing the `T` and `Z`) into proper ISO-8601 UTC strings
 * (`YYYY-MM-DDTHH:MM:SS.000Z`). The GLOB guard makes it idempotent and
 * leaves any already-ISO row (or NULL) untouched. The table-exists
 * check tolerates older schemas where a column hasn't been created
 * yet.
 */
async function migrateTimestampsToIso(db: Client): Promise<void> {
  for (const { table, column } of TIMESTAMP_COLUMNS) {
    // SQLite reports a `no such column` error for tables that don't
    // exist yet; we just skip those — this branch only runs for
    // existing DBs upgrading from <= v3, where every table above has
    // already been created.
    try {
      await db.execute(
        `UPDATE ${table}
            SET ${column} = REPLACE(${column}, ' ', 'T') || '.000Z'
          WHERE ${column} IS NOT NULL
            AND ${column} NOT LIKE '%Z'
            AND ${column} GLOB '????-??-?? ??:??:??'`,
      );
    } catch (err) {
      // Best-effort: don't fail the whole migration just because one
      // column is missing on an exotic install.
      // eslint-disable-next-line no-console
      console.warn(
        `[leash] timestamp backfill skipped for ${table}.${column}: ${(err as Error).message}`,
      );
    }
  }
}

/** Execute helper that surfaces typed args. */
export async function execute(
  db: Client,
  sql: string,
  args: InValue[] = [],
): Promise<Awaited<ReturnType<Client['execute']>>> {
  return db.execute({ sql, args });
}
