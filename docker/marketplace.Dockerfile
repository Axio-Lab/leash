# syntax=docker/dockerfile:1.7
#
# `@leashmarket/marketplace` — leash.market (Next.js, `output: 'standalone'`).
#
# Build context MUST be the monorepo root. On Railway:
#   Root Directory   = `/`
#   Config as code   = `docker/marketplace.railway.json`
#
# ─── REQUIRED BUILD-TIME VARS (NEXT_PUBLIC_*) ─────────────────────────
# Next.js inlines `NEXT_PUBLIC_*` values into the client bundle at
# `next build` time — NOT at container start. Railway (and any other
# Docker host) only forwards service variables into the build stage
# when they are declared as `ARG`, so we declare each public env var
# and re-export it as `ENV` for the build command.
#
# Set these as service variables in Railway → Variables (or pass
# `--build-arg KEY=value` locally). If you only set them as runtime
# env, the bundle will hard-code empty strings and the app will fall
# back to local defaults even though the container environment looks
# correct.
#
#   NEXT_PUBLIC_PRIVY_APP_ID         (must equal PRIVY_APP_ID)
#   NEXT_PUBLIC_AGENTS_URL           e.g. https://agents.leash.market
#   NEXT_PUBLIC_SOLANA_RPC           must match agents app
#   NEXT_PUBLIC_SOLANA_NETWORK       solana-devnet | solana-mainnet
#   NEXT_PUBLIC_EXPLORER_URL         e.g. https://explorer.leash.market
#
# ─── REQUIRED RUNTIME VARS (set on the Railway service) ───────────────
#   PRIVY_APP_ID                     (== NEXT_PUBLIC_PRIVY_APP_ID)
#   PRIVY_APP_SECRET
#   LEASH_API_URL                    e.g. https://api.leash.market
#   LEASH_API_ADMIN_SECRET           shared with apps/api
#   LEASH_DB_URL                     libsql://... (Turso) for prod
#   LEASH_DB_AUTH_TOKEN              Turso auth token (omit for local file)
# Optional:
#   LEASH_ADMIN_PRIVY_IDS            comma-separated Privy ids that can
#                                    access /creator/admin/queue

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
COPY . .

ARG NEXT_PUBLIC_PRIVY_APP_ID=""
ARG NEXT_PUBLIC_AGENTS_URL=""
ARG NEXT_PUBLIC_SOLANA_RPC=""
ARG NEXT_PUBLIC_SOLANA_NETWORK=""
ARG NEXT_PUBLIC_EXPLORER_URL=""
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_AGENTS_URL=$NEXT_PUBLIC_AGENTS_URL \
    NEXT_PUBLIC_SOLANA_RPC=$NEXT_PUBLIC_SOLANA_RPC \
    NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK \
    NEXT_PUBLIC_EXPLORER_URL=$NEXT_PUBLIC_EXPLORER_URL

RUN pnpm install --frozen-lockfile --filter "@leashmarket/marketplace..."
RUN pnpm turbo run build --filter=@leashmarket/marketplace

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=4200 \
    NEXT_TELEMETRY_DISABLED=1

# Standalone output is a self-contained server bundle. Copy the
# traced `node_modules` + server.js, then layer the static assets
# Next leaves out of the bundle (`.next/static` + `public/`).
COPY --from=build /app/apps/marketplace/.next/standalone ./
COPY --from=build /app/apps/marketplace/.next/static ./apps/marketplace/.next/static
COPY --from=build /app/apps/marketplace/public ./apps/marketplace/public

EXPOSE 4200
CMD ["node", "apps/marketplace/server.js"]
