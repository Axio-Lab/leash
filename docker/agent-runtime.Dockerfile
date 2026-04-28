# syntax=docker/dockerfile:1.7
#
# `@leash/agent-runtime` — task-loop worker that polls the shared Turso DB,
# claims pending tasks, runs the LLM tool loop, and publishes activity
# events to Redis. Same shape as `indexer.Dockerfile` (worker, no HTTP
# port).
#
# Deploy order: this worker is a pure DB consumer. The schema (`agents`,
# `tasks`, `task_activities`, …) is owned by `@leash/api` and applied by
# `runMigrations` on every API/indexer container start. Always deploy
# `@leash/api` (or run `pnpm -F @leash/api db:migrate`) first against a
# fresh `LEASH_DB_URL` before this worker starts, otherwise it will
# crash with `no such table: tasks`.
#
# Build context MUST be the monorepo root. On Railway:
#   Root Directory  = /
#   Config as code  = docker/agent-runtime.railway.json
#
# Required env at runtime:
#   LEASH_DB_URL           libsql url (same value the API uses)
#   ENCRYPTION_KEY         64-hex (32 bytes); MUST match the API
# Optional:
#   LEASH_DB_AUTH_TOKEN    Turso auth token (hosted libsql only)
#   LEASH_REDIS_URL        Redis URL for live activity pub/sub (recommended)
#   LEASH_RUNTIME_POLL_MS  Poll interval when no tasks are queued (default 750)

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@leash/agent-runtime..."
RUN pnpm turbo run build --filter=@leash/agent-runtime

FROM build AS prune
RUN pnpm --filter @leash/agent-runtime deploy --prod /out

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prune /out ./

CMD ["node", "dist/cli.js"]
