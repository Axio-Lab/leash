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

const SCHEMA_VERSION = 18;

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
    owner_wallet TEXT,
    scopes TEXT,
    -- AES-GCM envelope (same format as user_llm_keys.envelope) of the
    -- plaintext key. Lets the BFF reveal the key on demand so users can
    -- copy it later instead of only at creation time. NULL for legacy
    -- rows minted before the v10 migration; new keys always have a value.
    encrypted_plaintext TEXT,
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
  // v12: webhook subscriptions can now be keyed to either an API key
  // (legacy / web product, every event in `network` matches) or to an
  // agent_mint (standalone MCP/CLI authenticated via X-Leash-Sig, only
  // events whose `agent_asset` matches `agent_mint` fan out). Exactly
  // one of `api_key_id` / `agent_mint` is set; the CHECK constraint
  // enforces it. The original `(api_key_id, url)` UNIQUE is preserved
  // for legacy keys; we add a parallel `(agent_mint, url)` UNIQUE for
  // agent-keyed rows.
  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    api_key_id TEXT,
    agent_mint TEXT,
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events_json TEXT NOT NULL DEFAULT '[]',
    disabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (
      (api_key_id IS NOT NULL AND agent_mint IS NULL) OR
      (api_key_id IS NULL AND agent_mint IS NOT NULL)
    ),
    UNIQUE (api_key_id, url),
    UNIQUE (agent_mint, url),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_webhooks_network ON webhooks(network) WHERE disabled_at IS NULL`,
  // NOTE: `idx_webhooks_agent_mint` is created inside `migrateWebhooksAgentMint`
  // and re-asserted unconditionally at the end of `runMigrations` so brand-new
  // DBs (which skip the migration body) still get it. Declaring it here would
  // race the v12 migration on existing DBs (the column doesn't exist yet at
  // this point in the boot flow) and trip "no such column: agent_mint".

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
    payment_protocol TEXT NOT NULL DEFAULT 'x402',
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

  // ─────────────────────────────────────────────────────────────────────
  // Platform layer (v6+) — Privy-backed users for agent.leash.market &
  // leash.market, and the join table that maps a Privy user to one or
  // more `lsh_*` API keys with scope metadata.
  //
  // `platform_users.privy_id` is the Privy DID returned by their JWT.
  // `wallet` is the Solana pubkey of the user's connected (or embedded)
  // wallet — same value we pass as `owner_wallet` when issuing keys, so
  // analytics joins line up across platform_api_keys → api_keys.
  `CREATE TABLE IF NOT EXISTS platform_users (
    privy_id   TEXT PRIMARY KEY,
    wallet     TEXT NOT NULL,
    email      TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_users_wallet ON platform_users(wallet)`,

  // `scopes` is a JSON array like `["agents"]` / `["marketplace"]` /
  // `["agents","marketplace"]`. The same `lsh_*` key can be used on
  // both surfaces; scopes are advisory metadata for the BFF to enforce.
  `CREATE TABLE IF NOT EXISTS platform_api_keys (
    privy_id   TEXT NOT NULL,
    key_id     TEXT NOT NULL,
    name       TEXT NOT NULL,
    scopes     TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (privy_id, key_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_api_keys_key ON platform_api_keys(key_id)`,

  // ─────────────────────────────────────────────────────────────────────
  // Agents (v7) — the user-facing record of an agent created through
  // agent.leash.market. The MPL Core asset itself is minted browser-side
  // (Privy + Umi); this row is the platform's view: who owns it, what
  // tools it can use, what budget it operates under, and which service
  // key the agent-runtime worker uses to call apps/api on its behalf.
  //
  // `encrypted_llm_key` is AES-GCM ciphertext of the user's LLM provider
  // key (Anthropic / OpenAI). Decrypted only inside agent-runtime.
  // FKs to platform_users / api_keys intentionally omitted: SQLite
  // doesn't enforce them by default, and we want admin-driven seeding
  // (devnet, ops scripts) to work without first creating a Privy row.
  `CREATE TABLE IF NOT EXISTS agents (
    mint              TEXT PRIMARY KEY,
    owner_privy_id    TEXT NOT NULL,
    owner_wallet      TEXT NOT NULL,
    name              TEXT NOT NULL,
    description       TEXT,
    image_url         TEXT,
    network           TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    model             TEXT NOT NULL,
    system_prompt     TEXT NOT NULL,
    capabilities      TEXT NOT NULL DEFAULT '[]',
    services          TEXT NOT NULL DEFAULT '[]',
    budget_per_action TEXT NOT NULL DEFAULT '0.10',
    budget_per_task   TEXT NOT NULL DEFAULT '1.00',
    budget_per_day    TEXT NOT NULL DEFAULT '10.00',
    treasury          TEXT NOT NULL,
    service_key_id    TEXT NOT NULL,
    encrypted_llm_key TEXT NOT NULL,
    llm_provider      TEXT NOT NULL CHECK (llm_provider IN ('anthropic','openai','platform')),
    status            TEXT NOT NULL DEFAULT 'active',
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_privy_id)`,

  `CREATE TABLE IF NOT EXISTS agent_identity_profiles (
    agent_mint       TEXT PRIMARY KEY,
    network          TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    handle           TEXT UNIQUE,
    visibility       TEXT NOT NULL DEFAULT '{}',
    capability_cards TEXT NOT NULL DEFAULT '[]',
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (agent_mint) REFERENCES agents(mint)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_identity_profiles_handle ON agent_identity_profiles(handle) WHERE handle IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS agent_identity_domains (
    domain       TEXT PRIMARY KEY,
    agent_mint   TEXT NOT NULL,
    network      TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    status       TEXT NOT NULL CHECK (status IN ('pending','verified','failed')),
    verified_at  TEXT,
    last_error   TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (agent_mint) REFERENCES agents(mint)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_identity_domains_agent ON agent_identity_domains(agent_mint)`,

  `CREATE TABLE IF NOT EXISTS agent_identity_claims (
    id           TEXT PRIMARY KEY,
    agent_mint   TEXT NOT NULL,
    network      TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    issuer       TEXT NOT NULL,
    subject_mint TEXT NOT NULL,
    type         TEXT NOT NULL,
    value        TEXT NOT NULL,
    evidence_url TEXT,
    signature    TEXT NOT NULL,
    visibility   TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
    expires_at   TEXT,
    revoked_at   TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (agent_mint) REFERENCES agents(mint)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_identity_claims_agent ON agent_identity_claims(agent_mint, visibility, revoked_at)`,

  // ─────────────────────────────────────────────────────────────────────
  // Tasks (v8) — one row per "do this" the agent is given. The
  // agent-runtime worker claims pending tasks via UPDATE WHERE status
  // = 'pending' and runs the LLM loop until done / out_of_budget /
  // failed.
  `CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    agent_mint      TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    budget_cap      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','done','failed','out_of_budget')),
    spent           TEXT NOT NULL DEFAULT '0',
    final_output    TEXT,
    error           TEXT,
    started_at      TEXT,
    finished_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (agent_mint) REFERENCES agents(mint)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_agent_created ON tasks(agent_mint, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,

  // Each step inside a task: think → tool_call → payment → tool_result
  // → done | error. Payload is JSON; cost_usdc is set on payment rows.
  // The activity feed in the UI is live-streamed via Redis pub/sub but
  // also persisted here so reloads can replay history.
  `CREATE TABLE IF NOT EXISTS task_activities (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL,
    type         TEXT NOT NULL,
    payload      TEXT NOT NULL DEFAULT '{}',
    cost_usdc    TEXT,
    receipt_id   TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activities_task ON task_activities(task_id, created_at)`,

  // ─────────────────────────────────────────────────────────────────────
  // Automations (v17) — persistent background jobs owned by a Privy user
  // and executed by the user's on-chain agent. Triggers and connection
  // permissions are JSON so schedules, webhooks, and app events can share
  // one table without schema churn.
  `CREATE TABLE IF NOT EXISTS automations (
    id                   TEXT PRIMARY KEY,
    owner_privy_id       TEXT NOT NULL,
    agent_mint           TEXT NOT NULL,
    name                 TEXT NOT NULL,
    description          TEXT,
    instructions         TEXT NOT NULL DEFAULT '',
    status               TEXT NOT NULL DEFAULT 'paused'
                           CHECK (status IN ('enabled','paused')),
    trigger_type         TEXT NOT NULL
                           CHECK (trigger_type IN ('schedule','webhook','event')),
    trigger_config       TEXT NOT NULL DEFAULT '{}',
    source_config        TEXT NOT NULL DEFAULT '{}',
    delivery_policy      TEXT NOT NULL DEFAULT 'history_only'
                           CHECK (delivery_policy IN ('history_only','every_run','on_failure','on_condition','silent')),
    delivery_config      TEXT NOT NULL DEFAULT '{}',
    budget_per_run       TEXT NOT NULL DEFAULT '0',
    budget_per_day       TEXT NOT NULL DEFAULT '0',
    timezone             TEXT NOT NULL DEFAULT 'UTC',
    next_run_at          TEXT,
    last_run_at          TEXT,
    last_status          TEXT,
    failure_count        INTEGER NOT NULL DEFAULT 0,
    locked_by            TEXT,
    locked_until         TEXT,
    retention_days       INTEGER NOT NULL DEFAULT 30,
    deleted_at           TEXT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (agent_mint) REFERENCES agents(mint)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_automations_owner_updated ON automations(owner_privy_id, updated_at DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_automations_due ON automations(next_run_at) WHERE deleted_at IS NULL AND status = 'enabled'`,
  `CREATE INDEX IF NOT EXISTS idx_automations_lock ON automations(locked_until) WHERE deleted_at IS NULL AND status = 'enabled'`,

  `CREATE TABLE IF NOT EXISTS automation_runs (
    id                   TEXT PRIMARY KEY,
    automation_id        TEXT NOT NULL,
    owner_privy_id       TEXT NOT NULL,
    agent_mint           TEXT NOT NULL,
    trigger_type         TEXT NOT NULL,
    trigger_payload      TEXT NOT NULL DEFAULT '{}',
    status               TEXT NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued','running','succeeded','failed','skipped','cancelled')),
    output_text          TEXT,
    error                TEXT,
    source_summary       TEXT NOT NULL DEFAULT '{}',
    delivery_status      TEXT,
    delivery_result      TEXT NOT NULL DEFAULT '{}',
    spend_usd            TEXT NOT NULL DEFAULT '0',
    receipts             TEXT NOT NULL DEFAULT '[]',
    idempotency_key      TEXT,
    claimed_by           TEXT,
    started_at           TEXT,
    finished_at          TEXT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (automation_id) REFERENCES automations(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_automation_runs_auto_created ON automation_runs(automation_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_idempotency ON automation_runs(automation_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,

  // ─────────────────────────────────────────────────────────────────────
  // Marketplace listings (v9) — third-party MCP servers published on
  // leash.market. `pricing` and `tools` are JSON blobs validated at
  // POST time. `health_status` is updated by the hourly health-check
  // worker that pings each listing's `/.well-known/leash-mcp.json`.
  // FK to platform_users intentionally omitted — listings can be
  // backfilled by ops scripts or seed data before the user has logged
  // into the BFF (which is what creates the platform_users row).
  `CREATE TABLE IF NOT EXISTS listings (
    id              TEXT PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    category        TEXT NOT NULL,
    owner_privy_id  TEXT NOT NULL,
    owner_wallet    TEXT NOT NULL,
    endpoint        TEXT NOT NULL,
    pricing         TEXT NOT NULL DEFAULT '{}',
    tools           TEXT NOT NULL DEFAULT '[]',
    docs_url        TEXT,
    free_tier       INTEGER NOT NULL DEFAULT 0,
    health_status   TEXT,
    health_checked  TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','disabled')),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_listings_status_created ON listings(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category)`,

  `CREATE TABLE IF NOT EXISTS listing_ratings (
    listing_id   TEXT NOT NULL,
    privy_id     TEXT NOT NULL,
    stars        INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (listing_id, privy_id)
  )`,

  `CREATE TABLE IF NOT EXISTS listing_reviews (
    id          TEXT PRIMARY KEY,
    listing_id  TEXT NOT NULL,
    privy_id    TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_listing_reviews_listing ON listing_reviews(listing_id, created_at DESC)`,

  // ─────────────────────────────────────────────────────────────────────
  // Image blobs (v11) — content-addressable image store. Used by agent
  // creation: the user uploads a profile image, the bytes land here keyed
  // by sha256, and the resulting `/v1/uploads/{hash}` URL is embedded in
  // the EIP-8004 RegistrationV1 metadata document the agent mints with.
  //
  // We keep this table small and generic on purpose — it isn't bound to
  // any agent row. A future cron can reap unreferenced blobs by scanning
  // every `agents.image_url` and deleting any hash that's no longer
  // mentioned. Bytes are stored as `data` BLOB; libsql exposes them as
  // base64 over JSON.
  `CREATE TABLE IF NOT EXISTS image_blobs (
    hash       TEXT PRIMARY KEY,
    mime       TEXT NOT NULL,
    bytes      BLOB NOT NULL,
    size       INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  // ─────────────────────────────────────────────────────────────────────
  // External chat bridges (v13) — Telegram + WhatsApp connections that
  // forward messages from the user's own number/account into the same
  // Claude Agent SDK loop that powers the in-app chat.
  //
  // One row per (owner_privy_id, channel) connection. `routing_id`
  // is what inbound traffic is matched on:
  //   - Telegram: `sha256(bot_token)` so the public webhook URL never
  //     leaks the BYO token (`/v1/external/telegram/webhook/{routing_id}`).
  //   - WhatsApp (Phase 2): the user's own JID; Baileys lives in a
  //     separate worker but writes into the same row.
  //
  // `encrypted_credential` is the channel's secret material:
  //   - Telegram BYO bot token (small string).
  //   - WhatsApp Baileys auth state (JSON-serialized, can be larger).
  // Both sealed with the same `@leashmarket/platform-auth` AES-GCM envelope
  // we use for `agents.encrypted_llm_key`.
  //
  // `signing_mode` controls how chat-initiated signing tools resolve:
  //   - `deep_link` (Pattern A, default): bot replies with a one-time
  //     URL → user opens in apps/agents → existing Privy artifact UI.
  //   - `delegated` (Pattern C): bot signs inline using a server-held
  //     keypair (encrypted_delegated_key) capped at cap_per_tx /
  //     cap_per_day. Withdrawals + delegation changes always remain
  //     deep_link regardless of mode (enforced in route, not schema).
  //
  // `bound_chat_id` is `null` until the user runs `/start <token>` from
  // their phone; that handler captures `from.id`, clears
  // `verification_token`, and flips `status` from `pending` → `connected`.
  //
  // `allowlist_json` is reserved for future use: a JSON array of
  // additional from-IDs that are permitted to issue commands (e.g.
  // a household assistant phone). At launch only the `bound_chat_id`
  // can drive the agent.
  `CREATE TABLE IF NOT EXISTS external_connections (
    id                      TEXT PRIMARY KEY,
    owner_privy_id          TEXT NOT NULL,
    channel                 TEXT NOT NULL CHECK (channel IN ('telegram','whatsapp')),
    status                  TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','connected','error','revoked')),
    display_name            TEXT,
    encrypted_credential    TEXT,
    routing_id              TEXT,
    bot_username            TEXT,
    verification_token      TEXT,
    bound_chat_id           TEXT,
    allowlist_json          TEXT NOT NULL DEFAULT '[]',
    signing_mode            TEXT NOT NULL DEFAULT 'deep_link'
                              CHECK (signing_mode IN ('deep_link','delegated')),
    cap_per_tx              TEXT,
    cap_per_day             TEXT,
    daily_spent             TEXT NOT NULL DEFAULT '0',
    daily_window_start      TEXT,
    encrypted_delegated_key TEXT,
    delegated_pubkey        TEXT,
    last_seen_at            TEXT,
    error                   TEXT,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_external_connections_owner ON external_connections(owner_privy_id, created_at DESC)`,
  // Routing index used by the Telegram webhook to look up which connection
  // an inbound update belongs to. WHERE clause keeps revoked rows out.
  `CREATE INDEX IF NOT EXISTS idx_external_connections_routing ON external_connections(channel, routing_id) WHERE routing_id IS NOT NULL AND status != 'revoked'`,
  `CREATE INDEX IF NOT EXISTS idx_external_connections_verification ON external_connections(verification_token) WHERE verification_token IS NOT NULL`,

  // Audit/observability ledger for the bridge. Stores message metadata
  // only — never plaintext bodies or tool arguments. body_hash is a
  // sha256 of the user-visible text so we can de-dup retries from
  // Telegram/Baileys without needing to retain the body itself.
  // payload is a small JSON blob with `kind` + `tool_name` + lengths.
  `CREATE TABLE IF NOT EXISTS external_messages (
    id              TEXT PRIMARY KEY,
    connection_id   TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound','tool_call','tool_result','approval')),
    body_hash       TEXT,
    payload         TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (connection_id) REFERENCES external_connections(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_external_messages_conn_ts ON external_messages(connection_id, created_at DESC)`,

  // One-time approval tokens minted when an external-channel message
  // wants to invoke a signing tool that we won't sign server-side
  // (Pattern A, plus the always-deep-link tools under Pattern C).
  // The bot replies with `https://agents.leash.market/approve/<token>`;
  // that page reads the row, renders the existing artifact UI, and
  // POSTs the result back to mark consumed_at + result_*.
  //
  // payload is the JSON args the tool was called with (recipient, amount,
  // network, etc.) — same shape as the corresponding LEASH_TOOLS input.
  // We persist it so the approve UI can render a meaningful preview
  // even minutes after the bot generated the link.
  //
  // Tokens expire after `external_approvals.expires_at` (default 5 min).
  // consumed_at is set to a non-null ISO once the user signs (or
  // explicitly cancels — distinguishable via result_error). Tokens are
  // single-use: a UNIQUE constraint on the column would force NULL
  // collisions, so the route enforces "consumed_at IS NULL" instead.
  `CREATE TABLE IF NOT EXISTS external_approvals (
    token               TEXT PRIMARY KEY,
    connection_id       TEXT NOT NULL,
    owner_privy_id      TEXT NOT NULL,
    agent_mint          TEXT NOT NULL,
    tool_name           TEXT NOT NULL,
    payload             TEXT NOT NULL DEFAULT '{}',
    expires_at          TEXT NOT NULL,
    consumed_at         TEXT,
    result_receipt_hash TEXT,
    result_tx_sig       TEXT,
    result_error        TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (connection_id) REFERENCES external_connections(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_external_approvals_conn_ts ON external_approvals(connection_id, created_at DESC)`,

  // ── v14: WhatsApp / Baileys session state ───────────────────────────
  // Single row per connection_id holding the full Baileys
  // `AuthenticationState` serialised through `BufferJSON.replacer` and
  // sealed with the platform AES-GCM key. We split creds and keys into
  // two columns so the hot-path (saveCreds, fired on every message)
  // doesn't have to re-encrypt the much larger keys blob.
  //
  // `last_qr` is the most recent QR pairing payload Baileys emitted for
  // this connection. The BFF polls /v1/external/whatsapp/qr/{id} until
  // it goes null (= paired) or the connection's status flips to
  // 'connected'. Plaintext on purpose — QR codes are short-lived
  // (~60s) and only useful inside an active pairing flow.
  `CREATE TABLE IF NOT EXISTS external_whatsapp_state (
    connection_id     TEXT PRIMARY KEY,
    encrypted_creds   TEXT,
    encrypted_keys    TEXT,
    last_qr           TEXT,
    last_qr_at        TEXT,
    me_jid            TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (connection_id) REFERENCES external_connections(id)
  )`,
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
  const cur = await db.execute('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1');
  const currentVersion = cur.rows.length > 0 ? Number(cur.rows[0]!.version) : 0;

  if (currentVersion < 15) {
    await migratePaymentLinksPaymentProtocol(db);
  }

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

  // v5: optional `owner_wallet` on api_keys — Solana pubkey of the customer
  // who owns the key (for ops / support). Existing DBs get ALTER + index.
  if (currentVersion < 5) {
    await migrateApiKeysOwnerWallet(db);
  }

  // v6: add `scopes` column to api_keys for surface-aware key issuance
  // (`["agents"]`, `["marketplace"]`, etc.). The new platform_* tables
  // are covered by `IF NOT EXISTS` in SCHEMA_SQL above; only the column
  // add needs an explicit migration on existing DBs.
  if (currentVersion < 6) {
    await migrateApiKeysScopes(db);
  }

  // v10: encrypted_plaintext column on api_keys so the BFF can reveal
  // keys after creation. Existing rows stay NULL — old keys remain
  // hash-only and aren't recoverable; new keys mint with a value.
  if (currentVersion < 10) {
    await migrateApiKeysEncryptedPlaintext(db);
  }

  // v11: agent identity expansion + content-addressable image store.
  //   - Adds `description`, `image_url`, `services` columns to `agents`.
  //   - Widens the `llm_provider` CHECK to include `'platform'` (the
  //     existing schema rejected the value the platform-managed flow
  //     has been writing for months — table rebuild required because
  //     SQLite can't ALTER a CHECK constraint).
  //   - Creates `image_blobs` (already covered by IF NOT EXISTS in
  //     SCHEMA_SQL above; no work needed for new DBs).
  if (currentVersion < 11) {
    await migrateAgentsExpansion(db);
  }

  // v12: webhooks can be keyed to an `agent_mint` instead of an
  // `api_key_id`. Adds the column + relaxes the `api_key_id NOT NULL`
  // constraint via table rebuild (SQLite cannot drop NOT NULL or
  // change a CHECK in place). Idempotent.
  if (currentVersion < 12) {
    await migrateWebhooksAgentMint(db);
  }

  // v17: automations become executable. Adds explicit run
  // instructions plus a lightweight worker lease (`locked_by`,
  // `locked_until`) used by the scheduler to claim due rows safely.
  if (currentVersion < 17) {
    await migrateExecutableAutomations(db);
  }

  // Always-on index assertions. These run after every boot — they're
  // cheap (`IF NOT EXISTS`) and idempotent, and they cover the case
  // where a brand-new DB takes the latest `SCHEMA_SQL` directly and
  // every versioned migration short-circuits.
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_webhooks_agent_mint ON webhooks(agent_mint) WHERE disabled_at IS NULL`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_automations_lock ON automations(locked_until) WHERE deleted_at IS NULL AND status = 'enabled'`,
  );

  if (currentVersion < SCHEMA_VERSION) {
    await db.execute({
      sql: 'INSERT OR REPLACE INTO schema_version(version) VALUES(?)',
      args: [SCHEMA_VERSION],
    });
  }
}

async function migratePaymentLinksPaymentProtocol(db: Client): Promise<void> {
  const info = await db.execute('PRAGMA table_info(payment_links)');
  const names = new Set(info.rows.map((r) => String((r as Record<string, unknown>).name ?? '')));
  if (!names.has('payment_protocol')) {
    await db.execute(
      `ALTER TABLE payment_links ADD COLUMN payment_protocol TEXT NOT NULL DEFAULT 'x402'`,
    );
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
async function migrateApiKeysOwnerWallet(db: Client): Promise<void> {
  const info = await db.execute('PRAGMA table_info(api_keys)');
  const names = new Set(info.rows.map((r) => String((r as Record<string, unknown>).name ?? '')));
  if (!names.has('owner_wallet')) {
    await db.execute('ALTER TABLE api_keys ADD COLUMN owner_wallet TEXT');
  }
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_api_keys_owner_wallet ON api_keys(owner_wallet) WHERE owner_wallet IS NOT NULL`,
  );
}

async function migrateApiKeysScopes(db: Client): Promise<void> {
  const info = await db.execute('PRAGMA table_info(api_keys)');
  const names = new Set(info.rows.map((r) => String((r as Record<string, unknown>).name ?? '')));
  if (!names.has('scopes')) {
    await db.execute('ALTER TABLE api_keys ADD COLUMN scopes TEXT');
  }
}

async function migrateApiKeysEncryptedPlaintext(db: Client): Promise<void> {
  const info = await db.execute('PRAGMA table_info(api_keys)');
  const names = new Set(info.rows.map((r) => String((r as Record<string, unknown>).name ?? '')));
  if (!names.has('encrypted_plaintext')) {
    await db.execute('ALTER TABLE api_keys ADD COLUMN encrypted_plaintext TEXT');
  }
}

/**
 * v11: expand the agents row + widen the llm_provider CHECK.
 *
 * Adds `description`, `image_url`, and `services` (JSON array) columns
 * via `ALTER TABLE` (cheap), then rebuilds the table to widen the
 * `llm_provider` CHECK from `('anthropic','openai')` to also accept
 * `'platform'` — the value the platform-managed flow has been writing.
 * SQLite cannot alter CHECK constraints in place, so we copy through
 * a temp table and atomically swap names.
 */
async function migrateAgentsExpansion(db: Client): Promise<void> {
  const info = await db.execute('PRAGMA table_info(agents)');
  const names = new Set(info.rows.map((r) => String((r as Record<string, unknown>).name ?? '')));
  if (!names.has('description')) {
    await db.execute('ALTER TABLE agents ADD COLUMN description TEXT');
  }
  if (!names.has('image_url')) {
    await db.execute('ALTER TABLE agents ADD COLUMN image_url TEXT');
  }
  if (!names.has('services')) {
    await db.execute(`ALTER TABLE agents ADD COLUMN services TEXT NOT NULL DEFAULT '[]'`);
  }

  // Rebuild the CHECK on llm_provider only if the current table still
  // has the legacy 2-value constraint. We probe by trying to insert a
  // dummy 'platform' row in a savepoint; if the existing constraint
  // already allows it, we're done. (Cheaper than parsing sqlite_master.)
  const probe = await db.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'",
  );
  const sql = String((probe.rows[0] as Record<string, unknown> | undefined)?.sql ?? '');
  if (!sql.includes("'platform'") && sql.includes('llm_provider')) {
    await db.execute('DROP TABLE IF EXISTS agents_v11_tmp');
    await db.execute(`CREATE TABLE agents_v11_tmp (
      mint              TEXT PRIMARY KEY,
      owner_privy_id    TEXT NOT NULL,
      owner_wallet      TEXT NOT NULL,
      name              TEXT NOT NULL,
      description       TEXT,
      image_url         TEXT,
      network           TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
      model             TEXT NOT NULL,
      system_prompt     TEXT NOT NULL,
      capabilities      TEXT NOT NULL DEFAULT '[]',
      services          TEXT NOT NULL DEFAULT '[]',
      budget_per_action TEXT NOT NULL DEFAULT '0.10',
      budget_per_task   TEXT NOT NULL DEFAULT '1.00',
      budget_per_day    TEXT NOT NULL DEFAULT '10.00',
      treasury          TEXT NOT NULL,
      service_key_id    TEXT NOT NULL,
      encrypted_llm_key TEXT NOT NULL,
      llm_provider      TEXT NOT NULL CHECK (llm_provider IN ('anthropic','openai','platform')),
      status            TEXT NOT NULL DEFAULT 'active',
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);
    await db.execute(`INSERT INTO agents_v11_tmp (
      mint, owner_privy_id, owner_wallet, name, description, image_url,
      network, model, system_prompt, capabilities, services,
      budget_per_action, budget_per_task, budget_per_day,
      treasury, service_key_id, encrypted_llm_key, llm_provider,
      status, created_at
    ) SELECT
      mint, owner_privy_id, owner_wallet, name, description, image_url,
      network, model, system_prompt, capabilities, services,
      budget_per_action, budget_per_task, budget_per_day,
      treasury, service_key_id, encrypted_llm_key, llm_provider,
      status, created_at
    FROM agents`);
    await db.execute('DROP TABLE agents');
    await db.execute('ALTER TABLE agents_v11_tmp RENAME TO agents');
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_privy_id)`);
  }
}

/**
 * v12: relax `webhooks.api_key_id NOT NULL` and add `agent_mint` so
 * standalone-agent webhooks (X-Leash-Sig auth) can land in the same
 * table. SQLite can't drop NOT NULL or change a CHECK in place, so
 * we rebuild and swap. Idempotent — the probe returns early if the
 * table already has the agent_mint column.
 */
async function migrateWebhooksAgentMint(db: Client): Promise<void> {
  const info = await db.execute('PRAGMA table_info(webhooks)');
  const names = new Set(info.rows.map((r) => String((r as Record<string, unknown>).name ?? '')));
  if (names.has('agent_mint')) return;

  await db.execute('DROP TABLE IF EXISTS webhooks_v12_tmp');
  await db.execute(`CREATE TABLE webhooks_v12_tmp (
    id TEXT PRIMARY KEY,
    api_key_id TEXT,
    agent_mint TEXT,
    network TEXT NOT NULL CHECK (network IN ('solana-devnet','solana-mainnet')),
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events_json TEXT NOT NULL DEFAULT '[]',
    disabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (
      (api_key_id IS NOT NULL AND agent_mint IS NULL) OR
      (api_key_id IS NULL AND agent_mint IS NOT NULL)
    ),
    UNIQUE (api_key_id, url),
    UNIQUE (agent_mint, url),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  )`);
  await db.execute(`INSERT INTO webhooks_v12_tmp (
    id, api_key_id, agent_mint, network, url, secret, events_json, disabled_at, created_at
  ) SELECT
    id, api_key_id, NULL, network, url, secret, events_json, disabled_at, created_at
  FROM webhooks`);
  await db.execute('DROP TABLE webhooks');
  await db.execute('ALTER TABLE webhooks_v12_tmp RENAME TO webhooks');
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_webhooks_network ON webhooks(network) WHERE disabled_at IS NULL`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_webhooks_agent_mint ON webhooks(agent_mint) WHERE disabled_at IS NULL`,
  );
}

async function migrateExecutableAutomations(db: Client): Promise<void> {
  const info = await db.execute('PRAGMA table_info(automations)');
  const names = new Set(info.rows.map((r) => String((r as Record<string, unknown>).name ?? '')));
  if (!names.has('instructions')) {
    await db.execute(`ALTER TABLE automations ADD COLUMN instructions TEXT NOT NULL DEFAULT ''`);
  }
  if (!names.has('locked_by')) {
    await db.execute('ALTER TABLE automations ADD COLUMN locked_by TEXT');
  }
  if (!names.has('locked_until')) {
    await db.execute('ALTER TABLE automations ADD COLUMN locked_until TEXT');
  }
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_automations_lock ON automations(locked_until) WHERE deleted_at IS NULL AND status = 'enabled'`,
  );
}

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
