# @leash/explorer

`explorer.leash.market` — the Leash protocol explorer. Solscan-style
search across agents, transactions, receipts, and events on **devnet
and mainnet**.

This is a thin Next.js (App Router) app. It does **no** RPC calls
itself — every screen reads from `api.leash.market` via server actions
that hold the right `lsh_test_*` / `lsh_live_*` key for the active
network.

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

```bash
LEASH_API_URL=https://api.leash.market
LEASH_EXPLORER_API_KEY_DEVNET=lsh_test_...
LEASH_EXPLORER_API_KEY_MAINNET=lsh_live_...
```

The browser **never** sees the API key. The `leash_network` cookie
(`devnet` | `mainnet`) drives which key the server reaches for.

## Local dev

```bash
pnpm --filter @leash/explorer dev
# http://localhost:3100
```

## Tests

```bash
pnpm --filter @leash/explorer test
```
