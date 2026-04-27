# syntax=docker/dockerfile:1.7
#
# `@leash/runner` — receipt runner HTTP server (`dist/cli.js`).
#
# Build context MUST be the monorepo root. On Railway: Root Directory = `/`,
# Config as code = `docker/runner.railway.json`.
#
# Env contract: this is a server process — it reads `process.env` at
# request/startup time, so Railway's runtime service variables are
# enough. Do NOT need build-time ARGs here (no Next.js inlining).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@leash/runner..."
RUN pnpm turbo run build --filter=@leash/runner

FROM build AS prune
RUN pnpm --filter @leash/runner deploy --prod /out

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prune /out ./
EXPOSE 8787
# `packages/runner` already prefers `process.env.PORT` (falls back to 8787).
CMD ["node", "dist/cli.js"]
