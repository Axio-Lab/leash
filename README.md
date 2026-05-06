# Leash v0.1

> **Stablecoin rails for autonomous agents.**

Two surfaces:

- [`agent.leash.market`](apps/agents) — mint an autonomous agent on Solana, fund
  its treasury with USDC, and let it run on the open MCP marketplace.
- [`leash.market`](apps/marketplace) — open MCP registry. Agents discover tools,
  pay per call, and rate them by what actually works.

Backed by:

- [`apps/api`](apps/api) — the prepare/sign/submit, agents, tasks, and
  marketplace HTTP API (Hono + OpenAPI 3.1).
- [`apps/agent-runtime`](apps/agent-runtime) — worker that runs the agent's LLM
  loop, calls MCPs, settles x402 payments, and emits live activity to Redis.
- [`apps/explorer`](apps/explorer) — public block-explorer-style view of every
  payment receipt.

## Requirements

- Node **≥ 20**
- [pnpm](https://pnpm.io) **9**

## Quick start

```bash
pnpm install
pnpm turbo run build
pnpm turbo run test typecheck lint
```

### Local demo of the agent platform

```bash
# 1. spin up Postgres-equivalent (Turso file DB, pre-seeded)
pnpm --filter @leashmarket/api db:migrate
pnpm --filter @leashmarket/api seed:demo       # 1 agent + 3 pending tasks
# (Marketplace listings populate organically once sellers register —
#  Favorites also surfaces the Solana Foundation pay-skills catalogue.)

# 2. backend
pnpm --filter @leashmarket/api dev                       # :8787
pnpm --filter @leashmarket/agent-runtime dev             # picks up the demo tasks

# 3. surfaces
pnpm --filter @leashmarket/agents dev                    # agent.leash.market on :4100
pnpm --filter @leashmarket/marketplace dev               # leash.market         on :4200
pnpm --filter @leashmarket/explorer dev                  # receipts explorer    on :3000
```

Sign in with Privy, watch the seeded agent run on `/agents/<mint>`, see
each tool call leave a receipt on the explorer.

### x402 demo (no platform)

1. **Seller** — `pnpm --filter @leashmarket/seller-demo start` (port `3001`).
2. **Buyer** — `SELLER_URL=http://localhost:3001 pnpm --filter @leashmarket/buyer-demo start` (polls seller).
3. **Runner** — `pnpm --filter @leashmarket/runner start` (JSONL feed on `:8787`).
4. **Playground** — `pnpm --filter @leashmarket/playground dev` (interactive UI; proxies receipts to `LEASH_RUNNER_URL`).

Scripted outline: `pnpm exec tsx scripts/e2e-demo.ts` (expects seller on `SELLER_URL`).

### Docs (Mintlify)

```bash
pnpm gen:docs
pnpm --filter @leashmarket/docs dev
```

## Environment

| Variable               | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `LEASH_KILL`           | `1` — env kill-switch (runner `/pause`, `/health`).                   |
| `LEASH_ONCHAIN_PAUSED` | `1` — mirror on-chain pause from an external watcher.                 |
| `SOLANA_RPC`           | RPC URL (demos, kits).                                                |
| `AGENT_ASSET`          | Core asset mint (demos).                                              |
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

### Production deployments

Each long-running service has a Railway-ready Dockerfile in [`docker/`](./docker)
(build context = repo root). Frontends can run on Railway _or_ Vercel — both
work with the same `next.config.ts` (`output: 'standalone'`).

| Service              | Dockerfile                        | Suggested host             |
| -------------------- | --------------------------------- | -------------------------- |
| `apps/api`           | `docker/api.Dockerfile`           | Railway                    |
| `apps/agent-runtime` | `docker/agent-runtime.Dockerfile` | Railway (no public domain) |
| `apps/agents`        | `docker/agents.Dockerfile`        | Vercel (recommended)       |
| `apps/marketplace`   | `docker/marketplace.Dockerfile`   | Vercel (recommended)       |
| `apps/explorer`      | `docker/explorer.Dockerfile`      | Vercel / Railway           |

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
