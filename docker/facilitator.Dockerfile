# syntax=docker/dockerfile:1.7
#
# Per-service Dockerfile for `@leash/facilitator` (the x402 facilitator
# HTTP server). Designed for the leash monorepo + Railway / Fly / any
# Docker host.
#
# Env contract: this is a server process — it reads `process.env` at
# request/startup time, so Railway's runtime service variables (e.g.
# `LEASH_FACILITATOR_*`) are enough. Do NOT need build-time ARGs here
# (no Next.js inlining).
#
# Strategy:
#   1. `base`    — pinned Node 22 + Corepack-activated pnpm.
#   2. `build`   — copies the whole workspace, runs a frozen install
#                  scoped to facilitator's transitive workspace deps,
#                  builds them via Turbo (so `@leash/core` is built
#                  before `@leash/facilitator`).
#   3. `prune`   — runs `pnpm deploy` to produce a self-contained
#                  facilitator directory at `/out` (own `package.json`,
#                  hoisted `node_modules`, built `dist/` only).
#   4. `runner`  — slim Node image that only carries the pruned
#                  output. Boot reads env (LEASH_FACILITATOR_*) and
#                  starts the binary directly.
#
# Build context MUST be the repo root, e.g.
#   docker build -f docker/facilitator.Dockerfile -t leash-facilitator .

# ---------- base ----------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH" \
    CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ---------- build ----------
# We need the full workspace here so the lockfile stays in sync and
# Turbo can compute the build graph for `@leash/facilitator...`.
# `.dockerignore` keeps node_modules / dist / .turbo / docs out so the
# context stays small.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@leash/facilitator..."
# Turbo uses tsconfig.build.json under the hood for both packages.
RUN pnpm --filter "@leash/facilitator..." build

# ---------- prune ----------
# `pnpm deploy --prod` materializes a deployable copy of the package
# under `/out`, with workspace deps replaced by real folders inside
# `/out/node_modules` and dev-only deps stripped. The package.json
# `files: ["dist"]` field controls what lands in the bundle.
FROM build AS prune
RUN pnpm --filter @leash/facilitator deploy --prod /out

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    LEASH_FACILITATOR_HOST=0.0.0.0
WORKDIR /app

# Bring in only the pruned facilitator + its hoisted deps.
COPY --from=prune /out ./

# x402 facilitator default; Railway will route public traffic via $PORT.
EXPOSE 8787

# Map Railway's $PORT (if present) onto LEASH_FACILITATOR_PORT so the
# binary binds where the platform expects without needing two vars set.
CMD ["sh", "-c", "LEASH_FACILITATOR_PORT=${LEASH_FACILITATOR_PORT:-${PORT:-8787}} node dist/cli.js"]
