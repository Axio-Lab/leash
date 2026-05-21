# @leashmarket/cli

Human-driven CLI for the Leash identity layer for AI agents. Mint
agent identities, verify sellers, check balances, discover
capabilities, pay paywalls, and inspect reputation — straight from
your terminal, no chat product or MCP host required.

## Install

```bash
npm install -g @leashmarket/cli
# or
pnpm add -g @leashmarket/cli
```

The binary is named `leash`. Pair it with `leash-mcp` (from
`@leashmarket/mcp`) when you want to expose the same identity to an
AI agent through STDIO.

## Configure

Same configuration model as `@leashmarket/mcp` — both binaries read the
same `~/.config/leash/agent.json` (chmod 600) and respect the same
environment variable overrides:

| env                   | example                                       |
| --------------------- | --------------------------------------------- |
| `LEASH_AGENT_MINT`    | `Agnt7XQ...`                                  |
| `LEASH_EXECUTIVE_KEY` | `5Jz...` (base58) or `[12,34,...]` (JSON arr) |
| `LEASH_NETWORK`       | `solana-mainnet` (default) / `solana-devnet`  |
| `LEASH_API_URL`       | `https://api.leash.market` (default)          |
| `LEASH_RPC_URL`       | **strongly recommended** — see below          |
| `LEASH_EXPLORER_URL`  | `https://explorer.leash.market` (default)     |

> **Bring your own RPC.** The default endpoints
> (`api.devnet.solana.com`, `api.mainnet-beta.solana.com`) are public,
> rate-limited, and slow. Each `leash pay` makes 3-5 RPC calls — on a
> public endpoint that's a 4-8s settlement, sometimes a 429. Set
> `LEASH_RPC_URL` (or `rpc_url` in `agent.json`) to a Helius / Triton /
> QuickNode / Alchemy / self-hosted endpoint and settlement drops
> under one second.

## Quickstart

`leash agent create` is a two-step flow on both devnet and mainnet —
fund the printed executive pubkey with SOL between the two calls.

```bash
# 1. Generate an executive keypair locally + capture the agent's
#    public profile (name, description, services). Returns
#    `funding_required` with the pubkey + amount.
leash agent create \
  --name "Plexpert" \
  --description "Onchain accountant for indie operators." \
  --service web=https://plexpert.xyz \
  --service api=https://api.plexpert.xyz

# 2. Fund it (devnet airdrop is free; mainnet uses any wallet).
solana airdrop 1 <executive_pubkey> --url https://api.devnet.solana.com

# 3. Re-run — same command resumes from the persisted draft +
#    keypair, mints + delegates + records, lands agent.json.
leash agent create

# 4. Confirm identity.
leash agent show

# 5. Look at the capability marketplace.
leash discover -q ocr --max-price 0.10

# 6. Vet a seller identity.
leash identity verify --mint <agent_mint> \
  --intent call_capability \
  --capability-slug premium-search \
  --protocol x402 \
  --require-domain
leash reputation <agent_mint>

# 7. Pay something.
leash pay https://example.com/x/abc123

# 8. Inspect activity.
leash receipts                                # latest receipts (newest first)
leash history --days 7                        # last week + USD totals
leash daily --days 14                         # per-day buckets
leash receipt c3c50cb352a2624f783ca6a51bdb7fbcd3b67f04b4a42cd431444db05504181a
                                              # full ReceiptV1 by hash

# 9. Cash out.
leash treasury balance
leash treasury withdraw --to <wallet> --amount 0.50 --token USDC
```

## All commands

```text
agent commands:
  agent create [--name N] [--description T] [--image URL]
               [--service name=https://endpoint] (repeatable)
               [--generate | --import --executive <secret>]
                                     two-step agent provisioning
  agent show                         print active agent identity
  agent export [--out PATH]          export agent.json
  agent import <PATH>                install an agent.json

treasury commands:
  treasury balance                   list SOL + token balances
  treasury withdraw --to W --amount N --token SOL|USDC|USDG|USDT
  treasury limit [--token USDC|USDG|USDT]
                                     show SPL Approve delegation + balance
  treasury set-limit [--token USDC|USDG|USDT]
                    (--unlimited | --revoke | --amount N)
                                     change the executive's SPL spend authority

marketplace + reputation:
  discover [-q QUERY] [--max-price N] [--pricing-type T]
           [--source leash|pay-skills|all] [--limit N]
                                     search Leash + pay.sh capabilities
                                     and show seller identity labels
  discover endpoints <fqn>           expand a pay.sh provider into endpoints
  identity resolve (--mint M | --handle H | --domain D)
                                     resolve a public identity profile
  identity verify (--mint M | --handle H | --domain D)
                  [--intent pay|call_capability|trust_claim|inspect]
                  [--capability-kind K] [--capability-slug S]
                  [--endpoint URL] [--protocol x402|mpp]
                  [--min-rating N] [--require-claim T] [--require-domain]
                                     verify identity or ask for trust verdict
  reputation <agent_mint> [--network solana-devnet|solana-mainnet]

activity:
  receipts [--limit N] [--direction outgoing|incoming|both]
                                     paginated receipt feed for the active agent
  receipt <receipt_hash>             fetch a single ReceiptV1 by hash
                                     (the same hash the explorer renders at
                                     /receipt/{hash})
  history [--days N] [--direction outgoing|incoming|both] [--limit N]
                                     receipts in the last N days (default 7)
                                     plus running USD totals (sent / received /
                                     net). Stables (USDC/USDG/USDT) summed at 1:1.
  daily [--days N]                   per-day P&L buckets for the last N days
                                     (default 7). One row per UTC day with
                                     sent_usd, received_usd, net_usd, counts.
  pay <link-url>                     probe → sign → settle an x402 paywall

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
pnpm --filter @leashmarket/cli typecheck
pnpm --filter @leashmarket/cli test
pnpm --filter @leashmarket/cli build
```

The compiled `dist/cli.js` is set executable so `npx -y @leashmarket/cli`
works without an extra step.
