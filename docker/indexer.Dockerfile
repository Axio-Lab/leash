# syntax=docker/dockerfile:1.7
#
# `@leash/api` — standalone indexer worker (`dist/indexer/cli.js`).
#
# Same image layers as api.Dockerfile; only the CMD differs.
# Build context MUST be the monorepo root. On Railway:
#   Root Directory = `/`
#   Config as code = `docker/indexer.railway.json`

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
RUN pnpm install --frozen-lockfile --filter "@leash/api..."
RUN pnpm turbo run build --filter=@leash/api

FROM build AS prune
RUN pnpm --filter @leash/api deploy --prod /out

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prune /out ./

# No HTTP port — this is a background worker, not an HTTP service.
CMD ["node", "dist/indexer/cli.js"]
