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
