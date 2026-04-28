# syntax=docker/dockerfile:1.7
#
# `@leash/agents` — agent.leash.market (Next.js, `output: 'standalone'`).
#
# Build context MUST be the monorepo root. On Railway / Vercel-with-docker:
# Root Directory = `/`, Config as code = `docker/agents.railway.json`.
#
# Same shape as docker/web.Dockerfile. NEXT_PUBLIC_* values are baked at
# build time, so declare each one you need as `ARG` and forward to `ENV`
# before `next build`.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
COPY . .

ARG NEXT_PUBLIC_PRIVY_APP_ID=""
ARG NEXT_PUBLIC_SOLANA_RPC=""
ARG NEXT_PUBLIC_SOLANA_NETWORK=""
ARG NEXT_PUBLIC_AGENTS_URL=""
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_SOLANA_RPC=$NEXT_PUBLIC_SOLANA_RPC \
    NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK \
    NEXT_PUBLIC_AGENTS_URL=$NEXT_PUBLIC_AGENTS_URL

RUN pnpm install --frozen-lockfile --filter "@leash/agents..."
RUN pnpm turbo run build --filter=@leash/agents

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=4100

COPY --from=build /app/apps/agents/.next/standalone ./
COPY --from=build /app/apps/agents/.next/static ./apps/agents/.next/static
COPY --from=build /app/apps/agents/public ./apps/agents/public

EXPOSE 4100
CMD ["node", "apps/agents/server.js"]
