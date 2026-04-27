# syntax=docker/dockerfile:1.7
#
# Static Mintlify site for `@leash/docs`.
#
# IMPORTANT — Railway / Docker build context:
#   The build context MUST be the **monorepo root** (`.`). If you set
#   Railway "Root Directory" to `apps/docs`, the snapshot only contains
#   that folder, so `pnpm-workspace.yaml`, `packages/schemas`, and
#   `scripts/gen-schema-docs.mjs` disappear → installs and filters fail.
#
#   For this image: Root Directory = `/` (repo root), and point the
#   service at `docker/docs.railway.json` (Config as code path).


FROM node:22-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive \
    PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH" \
    CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates unzip \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pnpm install --frozen-lockfile --filter "@leash/docs..."

# `^build` pulls in `@leash/schemas` before `gen-schema-docs.mjs` runs.
RUN pnpm turbo run build --filter=@leash/docs

WORKDIR /app/apps/docs
RUN pnpm exec mintlify export --output /tmp/docs-export.zip \
  && unzip -q /tmp/docs-export.zip -d /opt/site \
  && rm -f /tmp/docs-export.zip

# ---------- runtime ----------
# Mintlify ships `serve.js` in the export — static HTTP, honors $PORT.
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /opt/site ./
EXPOSE 3000
CMD ["node", "serve.js"]
