# Full monorepo image — each service overrides `command` in docker-compose.
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build

ENV NODE_ENV=production
EXPOSE 3000 3001 3003 8787

CMD ["node", "-e", "console.error('Override command in docker-compose'); process.exit(1)"]
