# syntax=docker/dockerfile:1.7
#
# `@leash/web` — Next.js playground (`output: 'standalone'`).
#
# Build context MUST be the monorepo root. On Railway: Root Directory = `/`,
# Config as code = `docker/web.railway.json`.
#
# Runtime uses Next's traced `standalone` bundle + copied `.next/static` and
# `public/` (required for assets).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
COPY . .

# Next.js inlines `NEXT_PUBLIC_*` values into the client bundle at
# `next build` time — NOT at container start. Railway (and any other
# Docker host) only forwards service variables into the build stage
# when they are declared as `ARG`, so we declare each public env var
# and re-export it as `ENV` for the build command.
#
# Set these as service variables in Railway → Variables (or pass
# `--build-arg KEY=value` locally). If you only set them as runtime
# env, the bundle will hard-code empty strings and the playground will
# show "Privy not configured" / wrong RPC even though the container
# environment looks correct.
ARG NEXT_PUBLIC_PRIVY_APP_ID=""
ARG NEXT_PUBLIC_PRIVY_CLIENT_ID=""
ARG NEXT_PUBLIC_SOLANA_RPC=""
ARG NEXT_PUBLIC_SOLANA_NETWORK=""
ARG NEXT_PUBLIC_LEASH_FACILITATOR_URL=""
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_PRIVY_CLIENT_ID=$NEXT_PUBLIC_PRIVY_CLIENT_ID \
    NEXT_PUBLIC_SOLANA_RPC=$NEXT_PUBLIC_SOLANA_RPC \
    NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK \
    NEXT_PUBLIC_LEASH_FACILITATOR_URL=$NEXT_PUBLIC_LEASH_FACILITATOR_URL

RUN pnpm install --frozen-lockfile --filter "@leash/web..."
RUN pnpm turbo run build --filter=@leash/web

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
