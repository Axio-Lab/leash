# @leash/explorer

`explorer.leash.market` — the Leash protocol explorer. Solscan-style
search across agents, transactions, receipts, and events on **devnet
and mainnet**.

## Architecture

The explorer is **internal infrastructure**, not a customer-facing API
client. It runs alongside the API process, the chain indexer, and the
webhook worker, and reads straight from the same shared state:

```
            ┌─────────────────────┐
            │  Solana RPC (×2)    │
            └─────────┬───────────┘
                      │ (read)
                      ▼
   indexer ─────► Turso / libsql ◄───── api (writes events / receipts)
                      ▲
                      │ (read)
                      │
   webhook worker ────┤
                      │
              ┌───────┴────────┐
              │  EXPLORER (this app)  │
              │  Next.js, server-only │
              └────────────────────────┘
```

- Every list view (`/events`, `/health`, recent feed on `/`) is a
  direct libsql read against the same DB the API writes to.
- The agent page (`/agent/<mint>`) makes direct Solana RPC calls via
  the snapshot helpers exported from `@leash/api`.
- There is **no API key**, **no `LEASH_API_URL`**, and **no HTTP hop**
  between the explorer and the API. They are peers in the same trust
  boundary.

The browser still only ever sees `'devnet' | 'mainnet'` (carried by
the `leash_network` cookie). All DB and RPC reads happen on the
Next.js server.

## Routes

| Path                    | Page                                     |
| ----------------------- | ---------------------------------------- |
| `/`                     | Recent events + recent receipts + status |
| `/events?kind=&cursor=` | Filterable, cursor-paginated event feed  |
| `/agent/<mint>`         | Identity, treasury, events, receipts     |
| `/tx/<sig>`             | Decoded Leash event(s) for a tx          |
| `/event/<id>`           | Single event lifecycle                   |
| `/receipt/<hash>`       | Receipt detail + chain navigation        |
| `/health`               | Indexer status for both networks         |
| `/search?q=…`           | Free-form search fallback                |

## Environment

See **`apps/explorer/.env.example`** for a copy-paste template (this repo did
not ship one earlier; variables were only documented here and in `lib/db.ts` /
`lib/rpc.ts`). Next.js loads **`apps/explorer/.env.local`** automatically.

The explorer shares its env with the rest of the infra (api, indexer,
webhook worker). Point it at the same database and the same RPC URLs
those processes use:

```bash
# Database — pick one (libsql for hosted Turso, file: for local dev).
# Both LEASH_DB_URL and the API's LEASH_API_DB_URL are accepted; if
# both are set, LEASH_DB_URL wins.
LEASH_DB_URL=libsql://leash-prod.turso.io
LEASH_DB_AUTH_TOKEN=...

# Solana RPC — also accepts LEASH_API_RPC_DEVNET / _MAINNET.
LEASH_RPC_DEVNET=https://api.devnet.solana.com
LEASH_RPC_MAINNET=https://your-helius-or-quicknode-mainnet
```

If you omit `LEASH_DB_URL`, the explorer falls back to
`file:./.leash-api.db` **under `apps/explorer/`**, which is not the same
path as the API’s default (`apps/api/.leash-api.db`). Use
`apps/explorer/.env.example` (or the same absolute DB path in both apps)
so the explorer sees the data the API/indexer wrote. RPC defaults are
the public Solana clusters.

## Local dev

The explorer imports from the compiled `@leash/api` package, so build
the workspace once first:

```bash
pnpm install
pnpm -r build
pnpm --filter @leash/explorer dev
# http://localhost:3100
```

If you change `@leash/api` and want the explorer to pick it up,
re-run `pnpm --filter @leash/api build`.

## Tests

```bash
pnpm --filter @leash/explorer test
```

The tests stub `@leash/api`'s storage and Umi helpers; they don't
require a real database or RPC.
