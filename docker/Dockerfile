# Full monorepo image — each service overrides `command` in docker-compose.
#
# NEXT_PUBLIC_* variables MUST be supplied as --build-arg (or via the
# build.args block in docker-compose.yml) because Next.js bakes them
# into the client bundle at `next build` time. They are NOT available
# at runtime via the environment — they must be present during the build.
#
# Required build args (no sensible default — must be explicit):
#   NEXT_PUBLIC_PRIVY_APP_ID
#
# Optional build args (defaults point at Leash production):
#   NEXT_PUBLIC_SOLANA_RPC        default: https://api.mainnet-beta.solana.com
#   NEXT_PUBLIC_SOLANA_NETWORK    default: solana-mainnet
#   NEXT_PUBLIC_EXPLORER_URL      default: https://explorer.leash.market
#   NEXT_PUBLIC_AGENTS_URL        default: https://agents.leash.market  (used by marketplace)

FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile

# ─── Declare build-time public vars ──────────────────────────────────────────
# These become ENV so that `next build` (run below) picks them up and
# embeds them in the client bundle.  After the build they have no effect
# at runtime — Next.js has already inlined them.
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_SOLANA_RPC=https://api.mainnet-beta.solana.com
ARG NEXT_PUBLIC_SOLANA_NETWORK=solana-mainnet
ARG NEXT_PUBLIC_EXPLORER_URL=https://explorer.leash.market
ARG NEXT_PUBLIC_AGENTS_URL=https://agents.leash.market

ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_SOLANA_RPC=$NEXT_PUBLIC_SOLANA_RPC \
    NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK \
    NEXT_PUBLIC_EXPLORER_URL=$NEXT_PUBLIC_EXPLORER_URL \
    NEXT_PUBLIC_AGENTS_URL=$NEXT_PUBLIC_AGENTS_URL

RUN pnpm turbo run build

ENV NODE_ENV=production

# agents: 4100  marketplace: 4200  explorer: 3100  api: 8801  facilitator: 8787
EXPOSE 3100 4100 4200 8787 8801

CMD ["node", "-e", "console.error('No command set — override `command` in docker-compose.yml or pass CMD.'); process.exit(1)"]
