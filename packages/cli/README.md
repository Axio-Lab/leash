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
| `LEASH_API_KEY`       | legacy bearer key for receipts/payment links  |
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

# 4b. Create an agent-owned API key for legacy bearer-token surfaces.
#     Plaintext is printed once; store it as LEASH_API_KEY where needed.
leash api-key create --label "local worker"
leash api-key list

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
leash pay https://api.leash.market/x/design-agent \
  --method POST \
  --body '{"prompt":"Design a landing page","style":"premium dark mode"}'

# 7b. Create a hosted paywall for an existing POST endpoint.
leash sell create-link \
  --label "Design agent" \
  --amount 1 \
  --method POST \
  --upstream-url https://api.example.com/design \
  --protocol x402 \
  --expected-body '{"prompt":"string","style":"string","format":"string"}'

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

api key commands:
  api-key create --label NAME [--network solana-devnet|solana-mainnet]
                                     create an agent-scoped API key via X-Leash-Sig
                                     (plaintext returned once)
  api-key list [--include-disabled] [--limit N]
                                     list this agent's keys (no plaintext)
  api-key revoke <id>                disable one agent-owned key

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
  identity profile                  show the active agent editable identity profile
  identity update [--handle H | --clear-handle]
                  [--capability-cards FILE] [--visibility FILE]
                                     update handle, visibility metadata, and replace
                                     the full capability-card array from JSON files
  identity domain verify --domain D verify a domain selector for the active agent
  identity claim add --file FILE    create a public/private signed claim from JSON
  identity claim revoke <id>        revoke one active-agent claim
  identity disclosure list          list selective-disclosure grants
  identity disclosure create --file FILE
                                     create a selective-disclosure grant from JSON
  identity disclosure revoke <id>   revoke a disclosure grant
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
  pay <link-url> [--method GET|POST] [--body <json>]
                                     probe → sign → settle x402/MPP paywall
  sell create-link --label L --amount N [--currency C] [--description …]
                    [--method GET|POST] [--upstream-url URL]
                    [--expected-body JSON] [--protocol x402|mpp]
                                     create a hosted payment link

misc:
  doctor                             config + RPC + API reachability check
  help, -h                           full help
  version, -v                        installed version

global flags:
  --json                             emit raw LeashToolResult payload
```

## Monetize an existing endpoint

`leash sell create-link` can create a hosted Leash URL for an API you already
run. Set `--upstream-url` to the seller endpoint and choose `--method GET` or
`--method POST`. Use `--protocol x402` for standard HTTP 402 payment links or
`--protocol mpp` for MPP problem+json paywalls. For POST endpoints,
`--expected-body '{}'` stores metadata that describes what buyers should send; it
is not the live body.

```bash
leash sell create-link \
  --label "Research agent" \
  --amount 0.25 \
  --currency USDC \
  --method POST \
  --upstream-url https://api.example.com/research \
  --protocol x402 \
  --expected-body '{"topic":"string","depth":"string"}'
```

At runtime the buyer sends the real request body to the hosted `/x/{id}` URL:

```bash
leash pay https://api.leash.market/x/research-agent \
  --method POST \
  --body '{"topic":"Solana agent payments","depth":"deep"}'
```

Leash settles payment, strips payment headers, forwards the buyer body to
`metadata.upstream_url`, and returns the upstream response.

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
