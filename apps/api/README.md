# `@leash/api` (internal)

This package is the source code for the **deployed** Leash API service
at `api.leash.market`. It is **not** open-source software you spin up
yourself — customers integrate via the hosted API and the
language-specific SDKs that ship with `@leash/*`.

This README is a developer-facing summary for the team operating that
hosted service. The user-facing contract lives in the docs at
`docs.leash.market/api`.

## What it is

A Hono app that mirrors `@leash/registry-utils` over HTTP so any
language can drive the protocol without reaching for a TypeScript SDK.
The same package also publishes:

- the **chain indexer** (`bin/leash-indexer`) — dual-network watcher
  that decodes `Execute` and registry instructions into `events` rows
- the **webhook worker** — fanout for outbound HTTP deliveries
- internal helpers consumed in-process by `@leash/explorer`
  (the Solscan-style read view on the same DB / RPC)

## Design highlights

- **Prepare/Send split.** Every mutating endpoint maps 1:1 to a
  `prepare*` function in `@leash/registry-utils`. The server returns an
  unsigned, base64-encoded transaction; the caller signs locally with
  whatever key material they own (Privy, hardware wallet, server env
  var, generated keypair) and POSTs the signed bytes back to
  `POST /v1/submit`. The server broadcasts and tracks confirmation.
- **API key auth with built-in network binding.** Keys prefixed with
  `lsh_test_` are bound to `solana-devnet`; `lsh_live_` keys are bound
  to `solana-mainnet`. There is no per-request network override —
  cross-network access requires a different key. This makes
  network-mixup mistakes structurally impossible.
- **Source of truth in Turso/SQLite.** Every prepare creates an
  `events` row (`phase=prepared`); submit transitions it to
  `submitted`; a background poller flips it to `confirmed` or
  `failed`. The same table powers metrics dashboards and the explorer.
- **Redis as a speed/coordination layer.** Distributed rate limiting,
  idempotency keys (24h TTL on `Idempotency-Key`), and hot-query
  caching all live in Redis. When `LEASH_API_REDIS_URL` is unset the
  server falls back to in-memory equivalents — fine for local dev,
  not for multi-instance prod.
- **OpenAPI 3.1 first.** The wire contract is the spec at
  `GET /openapi.json`; both the Mintlify reference and any polyglot
  client SDKs (Python, Go, Rust, Java, …) generate from it.

## Endpoint surface (v0.1)

Every prepare endpoint is `POST /v1/agents/{mint}/<area>/<action>/prepare`
and returns:

```json
{
  "event_id": "01HX…",
  "network": "solana-devnet",
  "transaction": {
    "base64": "<unsigned tx bytes>",
    "message_base64": "<just the message bytes>",
    "recent_blockhash": "…",
    "last_valid_block_height": 12345,
    "fee_payer": "<pubkey>",
    "signers": ["<pubkey>", "…"]
  },
  "echo": {
    /* per-endpoint fields */
  }
}
```

| Endpoint                                                   | Wraps `@leash/registry-utils`   |
| ---------------------------------------------------------- | ------------------------------- |
| `POST /v1/agents/{mint}/identity/prepare`                  | `prepareRegisterAgentIdentity`  |
| `POST /v1/agents/{mint}/executive/register/prepare`        | `prepareRegisterExecutive`      |
| `POST /v1/agents/{mint}/executive/delegate/prepare`        | `prepareDelegateExecution`      |
| `POST /v1/agents/{mint}/delegation/prepare`                | `prepareSetSpendDelegation`     |
| `POST /v1/agents/{mint}/delegation/revoke/prepare`         | `prepareRevokeSpendDelegation`  |
| `POST /v1/agents/{mint}/treasury/provision/prepare`        | `prepareProvisionTreasuryAtas`  |
| `POST /v1/agents/{mint}/treasury/withdraw/prepare`         | `prepareWithdrawTreasury`       |
| `POST /v1/agents/{mint}/treasury/withdraw-all/prepare`     | `prepareWithdrawTreasuryAll`    |
| `POST /v1/agents/{mint}/treasury/withdraw-sol/prepare`     | `prepareWithdrawTreasurySol`    |
| `POST /v1/agents/{mint}/treasury/withdraw-sol-all/prepare` | `prepareWithdrawTreasurySolAll` |
| `POST /v1/agents/{mint}/token/set/prepare`                 | `prepareSetAgentToken`          |

Read endpoints:

- `GET /v1/agents/{mint}` — identity + treasury + token status
- `GET /v1/agents/{mint}/treasury/balances` — SOL + SPL token balances

The implementation of these reads lives in `src/util/agent-snapshot.ts`
and is also exported for in-process use by `@leash/explorer`.

Submit + events:

- `POST /v1/submit` — broadcast a signed tx, optionally linked to a
  prepared `event_id`
- `GET /v1/events/{id}` — event lifecycle status
- `GET /v1/events?network=&kind=&agent=&from=&to=&cursor=` — filterable
  feed (network always defaults to the caller's key)

Receipts:

- `POST /v1/receipts/{agent}` — push ingest, idempotent on `receipt_hash`
- `GET /v1/receipts/{agent}` — paged feed for a single agent
- `GET /v1/receipts/by-hash/{hash}` — direct lookup
- `POST /v1/agents/{mint}/pull-target` — register a `services.receipts`
  URL the API will poll on a cadence

Health + observability:

- `GET /v1/health`
- `GET /v1/version`
- `GET /v1/indexer/status` — watchlist + cursor + recent activity counters
- `GET /v1/metrics/usage` — per-key, per-day request rollups

## Internal devs

If you're on the team and need to bring this up locally for testing,
look at `bootstrap.ts`, `dev.ts`, and the env vars referenced in
`config.ts`. This README intentionally does not document a self-host
flow because the API is not open source.

### One shared SQLite file (development)

Use a **single absolute `file:` URL** for every process (API, indexer,
explorer) so nobody reads `file:./…` from a different working directory.

1. Pick a path, e.g. `file:/Users/you/leash-data/leash-dev.db` (create
   the parent folder once).
2. In `apps/api/.env` (copy from `.env.example`), set:

   ```bash
   LEASH_API_DB_URL=file:/Users/you/leash-data/leash-dev.db
   ```

3. In `apps/explorer/.env.local`, set the **same** database (explorer
   also accepts `LEASH_DB_URL`):

   ```bash
   LEASH_DB_URL=file:/Users/you/leash-data/leash-dev.db
   ```

4. Build the API package once (`pnpm --filter @leash/api build`) so the
   explorer can import `@leash/api`.

5. Start the API from `apps/api` with env loaded (Node 20.6+):

   ```bash
   cd apps/api
   node --env-file=.env ./node_modules/.bin/tsx ./src/dev.ts
   ```

   Or export the vars in your shell (`set -a && source .env && set +a`,
   [direnv](https://direnv.net/), etc.) and run `pnpm dev` — `createConfig()`
   only reads `process.env`, it does not load `.env` by itself.

The first API or indexer start runs `runMigrations` and creates tables.
The explorer also runs migrations on first connect if the file is new.

### Starting the chain indexer

The indexer is **`@leash/api`**’s standalone loop: same DB + RPC as the
API, writes decoded rows into `events` / indexer tables and runs the
receipt-pull pass. It does **not** go through HTTP.

From the **monorepo root**:

```bash
pnpm --filter @leash/api build
pnpm --filter @leash/api indexer
```

That runs `node dist/indexer/cli.js` with your current shell env. From
`apps/api` with a `.env` file (Node 20.6+):

```bash
cd apps/api
pnpm build
node --env-file=.env dist/indexer/cli.js
```

For TypeScript without a rebuild on every change:

```bash
cd apps/api
node --env-file=.env ./node_modules/.bin/tsx ./src/indexer/cli.ts
```

…or export env and run **`pnpm indexer:dev`** from `apps/api` (same as
`tsx ./src/indexer/cli.ts`).

Useful env vars (all optional; see `src/indexer/cli.ts`):

| Variable                                         | Purpose                              |
| ------------------------------------------------ | ------------------------------------ |
| `LEASH_API_DB_URL`                               | Same libsql/SQLite URL as the API    |
| `LEASH_API_DB_AUTH_TOKEN`                        | Turso token when URL is `libsql://…` |
| `LEASH_API_RPC_DEVNET` / `LEASH_API_RPC_MAINNET` | RPC endpoints                        |
| `LEASH_INDEXER_INTERVAL_MS`                      | Tick interval (default 15000)        |
| `LEASH_INDEXER_DISABLE_DEVNET` / `…_MAINNET`     | Set to `1` to skip a network         |
| `LEASH_INDEXER_DISABLE_PULL`                     | Set to `1` to skip receipt-pull      |

Typical local layout: **terminal 1** API, **terminal 2** indexer,
**terminal 3** `pnpm --filter @leash/explorer dev` — all three share
`LEASH_API_DB_URL` / `LEASH_DB_URL` to the same file.
