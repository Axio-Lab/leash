# Leash service Docker images

Each `*.Dockerfile` in this folder is a self-contained build for one
service. Build context is **always** the monorepo root.

```bash
# from the repo root
docker build -f docker/<service>.Dockerfile -t leash-<service> .
```

For Railway, point each service at its `*.railway.json`:

- Root Directory: `/`
- Config as code: `docker/<service>.railway.json`

> **Build args note** — Next.js inlines `NEXT_PUBLIC_*` at `next build`
> time, NOT at container start. Service variables on Railway are
> automatically passed as `--build-arg` for any matching `ARG` declared
> in the Dockerfile, so set them on the **service** (not just runtime).

---

## `@leash/agents` — agents.leash.market (port 4100)

### Build-time vars (`NEXT_PUBLIC_*`, baked into client bundle)

| Name                         | Required | Notes                                |
| ---------------------------- | -------- | ------------------------------------ |
| `NEXT_PUBLIC_PRIVY_APP_ID`   | ✓        | Must equal `PRIVY_APP_ID`            |
| `NEXT_PUBLIC_SOLANA_RPC`     | ✓        | e.g. `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_SOLANA_NETWORK` | ✓        | `solana-devnet` \| `solana-mainnet`  |
| `NEXT_PUBLIC_EXPLORER_URL`   | ✓        | e.g. `https://explorer.leash.market` |

### Runtime vars (server only)

| Name                     | Required                                  | Notes                                            |
| ------------------------ | ----------------------------------------- | ------------------------------------------------ |
| `PRIVY_APP_ID`           | ✓                                         | == `NEXT_PUBLIC_PRIVY_APP_ID`                    |
| `PRIVY_APP_SECRET`       | ✓                                         | Privy app secret                                 |
| `LEASH_API_URL`          | ✓                                         | e.g. `https://api.leash.market`                  |
| `LEASH_API_ADMIN_SECRET` | ✓                                         | Shared with `apps/api`                           |
| `LEASH_DB_URL`           | ✓                                         | `libsql://...` (Turso) for prod                  |
| `LEASH_DB_AUTH_TOKEN`    | ✓¹                                        | Required for hosted Turso, omit for `file:` URLs |
| `ENCRYPTION_KEY`         | ✓                                         | 64 hex chars (32 bytes), shared w/ api           |
| `ANTHROPIC_API_KEY`      | ✓²                                        | Platform fallback when user has no BYOK          |
| `COMPOSIO_API_KEY`       | ✓²                                        | Enables `/api/composio/*` toolkits               |
| `LEASH_AGENT_MODEL`      | optional                                  | Default `claude-sonnet-4-20250514`               |
| `LEASH_AGENT_STUB`       | leave UNSET in prod (forces stub replies) |

¹ Required when `LEASH_DB_URL` is `libsql://`.
² Without these the agent works but with reduced capability — the chat
brain falls back to a deterministic stub and Composio toolkits return
a "not configured" warning.

---

## `@leash/marketplace` — leash.market (port 4200)

### Build-time vars (`NEXT_PUBLIC_*`)

| Name                         | Required | Notes                                |
| ---------------------------- | -------- | ------------------------------------ |
| `NEXT_PUBLIC_PRIVY_APP_ID`   | ✓        | Must equal `PRIVY_APP_ID`            |
| `NEXT_PUBLIC_AGENTS_URL`     | ✓        | e.g. `https://agents.leash.market`   |
| `NEXT_PUBLIC_SOLANA_RPC`     | ✓        | Match the agents app                 |
| `NEXT_PUBLIC_SOLANA_NETWORK` | ✓        | `solana-devnet` \| `solana-mainnet`  |
| `NEXT_PUBLIC_EXPLORER_URL`   | ✓        | e.g. `https://explorer.leash.market` |

### Runtime vars

| Name                     | Required | Notes                                           |
| ------------------------ | -------- | ----------------------------------------------- |
| `PRIVY_APP_ID`           | ✓        | == `NEXT_PUBLIC_PRIVY_APP_ID`                   |
| `PRIVY_APP_SECRET`       | ✓        | Privy app secret                                |
| `LEASH_API_URL`          | ✓        | Same value as agents app                        |
| `LEASH_API_ADMIN_SECRET` | ✓        | Shared with `apps/api`                          |
| `LEASH_DB_URL`           | ✓        | Same DB as agents app                           |
| `LEASH_DB_AUTH_TOKEN`    | ✓¹       | Required for hosted Turso                       |
| `LEASH_ADMIN_PRIVY_IDS`  | optional | Comma-separated Privy ids w/ `/creator/admin/*` |

¹ Required when `LEASH_DB_URL` is `libsql://`.

---

## Local smoke build (no secrets)

To verify a Dockerfile builds end-to-end without provisioning real
secrets, you can pass empty `--build-arg`s — the runtime defaults
inside `apps/*/lib/env.ts` cover the optional values:

```bash
docker build -f docker/agents.Dockerfile \
  --build-arg NEXT_PUBLIC_PRIVY_APP_ID= \
  --build-arg NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com \
  --build-arg NEXT_PUBLIC_SOLANA_NETWORK=solana-devnet \
  --build-arg NEXT_PUBLIC_EXPLORER_URL=https://explorer.leash.market \
  -t leash-agents .

docker build -f docker/marketplace.Dockerfile \
  --build-arg NEXT_PUBLIC_PRIVY_APP_ID= \
  --build-arg NEXT_PUBLIC_AGENTS_URL=https://agents.leash.market \
  --build-arg NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com \
  --build-arg NEXT_PUBLIC_SOLANA_NETWORK=solana-devnet \
  --build-arg NEXT_PUBLIC_EXPLORER_URL=https://explorer.leash.market \
  -t leash-marketplace .
```

The container will boot but routes that touch the BFF will 401 / 503
until you supply the runtime secrets above.
