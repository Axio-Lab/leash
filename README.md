# Leash v0.1

Monorepo: **schemas → core → kits → runner → apps**. See [`LEASH.md`](./LEASH.md) for product context.

## Requirements

- Node **≥ 20**
- [pnpm](https://pnpm.io) **9**

## Quick start

```bash
pnpm install
pnpm turbo run build
pnpm turbo run test typecheck lint
```

### 5-minute demo (local)

1. **Seller** — `pnpm --filter @leash/seller-demo start` (port `3001`).
2. **Buyer** — `SELLER_URL=http://localhost:3001 pnpm --filter @leash/buyer-demo start` (polls seller).
3. **Runner** — `pnpm --filter @leash/runner start` (JSONL feed on `:8787`).
4. **Web** — `pnpm --filter @leash/web dev` (explorer; proxies receipts to `LEASH_RUNNER_URL`).

Scripted outline: `pnpm exec tsx scripts/e2e-demo.ts` (expects seller on `SELLER_URL`).

### Docs (Mintlify)

```bash
pnpm gen:docs
pnpm --filter @leash/docs dev
```

## Environment

| Variable               | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `LEASH_KILL`           | `1` — env kill-switch (runner `/pause`, `/health`).                   |
| `LEASH_ONCHAIN_PAUSED` | `1` — mirror on-chain pause from an external watcher.                 |
| `SOLANA_RPC`           | RPC URL (demos, kits).                                                |
| `AGENT_ASSET`          | Core asset mint (demos).                                              |
| `PINATA_JWT`           | Pinata JWT for `upload-registration` / registry uploads.              |
| `LEASH_RUNNER_URL`     | Web app proxy for `receipts.jsonl` (default `http://localhost:8787`). |

## Docker

**Split stack (default):** runner + seller-demo + web.

```bash
docker compose up --build
```

**Merged profile** (single buy+sell process):

```bash
docker compose --profile merged up --build merged-demo
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
