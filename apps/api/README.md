# `@leash/api`

Public Leash API server (`api.leash.market`) — a Hono app that mirrors
`@leash/registry-utils` over HTTP so any language can drive the protocol
without reaching for a TypeScript SDK.

## What it does

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

## Quickstart

```bash
cp apps/api/.env.example apps/api/.env
pnpm --filter @leash/api dev
# server: http://localhost:8801
# OpenAPI: http://localhost:8801/openapi.json
```

Set `LEASH_API_BOOTSTRAP_KEY=lsh_test_demo_localdev_only_replace_me`
in your env to skip the "create your first key" step on a fresh DB.

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

Submit + events:

- `POST /v1/submit` — broadcast a signed tx, optionally linked to a
  prepared `event_id`
- `GET /v1/events/{id}` — event lifecycle status
- `GET /v1/events?network=&kind=&agent=&from=&to=&cursor=` — filterable
  feed (network always defaults to the caller's key)

Health:

- `GET /v1/health`
- `GET /v1/version`

## Receipts, indexer, and explorer

Phase 2 of the rollout adds receipt push/pull endpoints
(`POST /v1/receipts/{agent}`, `GET /v1/receipts/by-hash/{hash}`); Phase 3
adds the dual-network chain indexer; Phase 4 adds
`explorer.leash.market`. All three surfaces read the same
`events`/`receipts` tables this server writes.
