# @leash/cli

Human-driven CLI for the Leash agent economy. Mint agents, check
balances, pay paywalls, discover services, and inspect reputation —
straight from your terminal, no chat product or MCP host required.

## Install

```bash
npm install -g @leash/cli
# or
pnpm add -g @leash/cli
```

The binary is named `leash`. Pair it with `leash-mcp` (from
`@leash/mcp`) when you want to expose the same identity to an
AI agent through STDIO.

## Configure

Same configuration model as `@leash/mcp` — both binaries read the
same `~/.config/leash/agent.json` (chmod 600) and respect the same
environment variable overrides:

| env                   | example                                       |
| --------------------- | --------------------------------------------- |
| `LEASH_AGENT_MINT`    | `Agnt7XQ...`                                  |
| `LEASH_EXECUTIVE_KEY` | `5Jz...` (base58) or `[12,34,...]` (JSON arr) |
| `LEASH_NETWORK`       | `solana-devnet` (default) / `solana-mainnet`  |
| `LEASH_API_URL`       | `https://api.leash.market` (default)          |
| `LEASH_RPC_URL`       | overrides the per-network default RPC         |

## Quickstart (devnet, auto-funded)

```bash
# 1. Mint a sandbox agent (auto-funds 0.01 SOL + $1 USDC, persists
#    agent.json, and you're ready to go in one command).
leash agent create

# 2. Confirm identity.
leash agent show

# 3. Look at the marketplace.
leash discover -q ocr --max-price 0.10

# 4. Vet a counterparty.
leash reputation <agent_mint>

# 5. Pay something.
leash pay https://example.com/x/abc123

# 6. Cash out.
leash treasury balance
leash treasury withdraw --to <wallet> --amount 0.50 --token USDC
```

## All commands

```text
agent commands:
  agent create [--name N]            mint a sandbox agent
  agent show                         print active agent identity
  agent export [--out PATH]          export agent.json
  agent import <PATH>                install an agent.json

treasury commands:
  treasury balance                   list SOL + token balances
  treasury withdraw --to W --amount N --token SOL|USDC|USDG|USDT

marketplace + reputation:
  discover [-q QUERY] [--max-price N] [--pricing-type T] [--limit N]
  reputation <agent_mint> [--network solana-devnet|solana-mainnet]

activity:
  receipts [--limit N] [--direction outgoing|incoming|both]
  pay <link-url>

misc:
  doctor                             config + RPC + API reachability check
  help, -h                           full help
  version, -v                        installed version

global flags:
  --json                             emit raw LeashToolResult payload
```

## Cross-interface portability

`leash agent export` and `leash agent import` are aliases for the
matching `leash-mcp` subcommands — same JSON shape, same on-disk
location. An agent minted in any host can roam to any other host
by exporting the file there and importing it on the new machine.

## Develop

```bash
pnpm --filter @leash/cli typecheck
pnpm --filter @leash/cli test
pnpm --filter @leash/cli build
```

The compiled `dist/cli.js` is set executable so `npx -y @leash/cli`
works without an extra step.
