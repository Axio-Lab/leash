# syntax=docker/dockerfile:1.7
#
# `@leash/explorer` — Next.js explorer (`output: 'standalone'`).
#
# Build context MUST be the monorepo root. On Railway: Root Directory = `/`,
# Config as code = `docker/explorer.railway.json`.
#
# Env contract: this app reads DB / RPC / Redis from `process.env` on the
# server only (no `NEXT_PUBLIC_*` today), so you do **not** need build-time
# ARGs for those — set them as Railway runtime variables. Rebuild only
# when you add client-inlined `NEXT_PUBLIC_*` vars (then mirror `web.Dockerfile`).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@leash/explorer..."
RUN pnpm turbo run build --filter=@leash/explorer

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build /app/apps/explorer/.next/standalone ./
COPY --from=build /app/apps/explorer/.next/static ./apps/explorer/.next/static
COPY --from=build /app/apps/explorer/public ./apps/explorer/public

EXPOSE 3000
CMD ["node", "apps/explorer/server.js"]
