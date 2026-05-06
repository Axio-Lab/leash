# syntax=docker/dockerfile:1.7
#
# `@leashmarket/api` — Hono HTTP API (`dist/cli.js`).
#
# Build context MUST be the monorepo root. On Railway: Root Directory = `/`,
# Config as code = `docker/api.railway.json`.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH" CI=1
# git + ca-certificates are required so pnpm can resolve the GitHub-hosted
# libsignal-node sub-dependency that baileys carries in its lockfile entry.
# The slim image ships without a CA bundle, so without ca-certificates
# `git ls-remote https://github.com/...` fails TLS verification.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@leashmarket/api..."
RUN pnpm turbo run build --filter=@leashmarket/api

FROM build AS prune
RUN pnpm --filter @leashmarket/api deploy --prod /out

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    LEASH_API_HOST=0.0.0.0
COPY --from=prune /out ./
EXPOSE 8801
# Railway injects `PORT`; the API reads `LEASH_API_PORT` (default 8801).
CMD ["sh", "-c", "LEASH_API_PORT=${LEASH_API_PORT:-${PORT:-8801}} node dist/cli.js"]
