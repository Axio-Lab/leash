# syntax=docker/dockerfile:1.7
#
# `@leash/marketplace` — leash.market (Next.js, `output: 'standalone'`).
#
# Build context MUST be the monorepo root. On Railway / Vercel-with-docker:
# Root Directory = `/`, Config as code = `docker/marketplace.railway.json`.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
COPY . .

ARG NEXT_PUBLIC_PRIVY_APP_ID=""
ARG NEXT_PUBLIC_AGENTS_URL=""
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_AGENTS_URL=$NEXT_PUBLIC_AGENTS_URL

RUN pnpm install --frozen-lockfile --filter "@leash/marketplace..."
RUN pnpm turbo run build --filter=@leash/marketplace

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=4200

COPY --from=build /app/apps/marketplace/.next/standalone ./
COPY --from=build /app/apps/marketplace/.next/static ./apps/marketplace/.next/static
COPY --from=build /app/apps/marketplace/public ./apps/marketplace/public

EXPOSE 4200
CMD ["node", "apps/marketplace/server.js"]
