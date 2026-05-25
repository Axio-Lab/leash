# @leashmarket/mcp

Standalone MCP server for the Leash identity layer for AI agents. It
lets any AI agent in any MCP host (Cursor, Claude Desktop, Cline,
Continue, ChatGPT-MCP, …) resolve and verify identities, inspect proof
trails, sign on-chain Solana transactions, pay x402 paywalls, and
MPP paywalls, create hosted payment links, and check its treasury balance —
without a browser in the loop.

## Install

```jsonc
// In Cursor → Settings → MCP, or your MCP host's equivalent:
{
  "mcpServers": {
    "leash": {
      "command": "npx",
      "args": ["-y", "@leashmarket/mcp"],
    },
  },
}
```

Most MCP hosts support an `env` map on each server — use it to override
the default public RPC (slow / rate-limited). Swap in your own URL:

```jsonc
{
  "mcpServers": {
    "leash": {
      "command": "npx",
      "args": ["-y", "@leashmarket/mcp"],
      "env": {
        "LEASH_RPC_URL": "https://devnet.helius-rpc.com/?api-key=YOUR_KEY",
        // optional — match mainnet if your agent + links are on mainnet:
        // "LEASH_NETWORK": "solana-mainnet",
        // "LEASH_RPC_URL": "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY",
      },
    },
  },
}
```

You can set any other overrides the same way (`LEASH_AGENT_MINT`,
`LEASH_EXECUTIVE_KEY`, `LEASH_API_URL`, `LEASH_EXPLORER_URL`, …).
Alternatively, put `rpc_url` in `~/.config/leash/agent.json` — env wins
over the file when both are set.

## Configure

The server looks at, in order:

1. `~/.config/leash/agent.json` (chmod 600). Same posture as
   `gcloud`/`gh`/`aws`.
2. Environment variables (override the file when set):

   | env                   | required                 | example                                       |
   | --------------------- | ------------------------ | --------------------------------------------- |
   | `LEASH_AGENT_MINT`    | yes                      | `Agnt7XQ...`                                  |
   | `LEASH_EXECUTIVE_KEY` | yes                      | `5Jz...` (base58) or `[12,34,...]` (JSON arr) |
   | `LEASH_NETWORK`       | no                       | `solana-mainnet` (default) / `solana-devnet`  |
   | `LEASH_API_URL`       | no                       | `https://api.leash.market` (default)          |
   | `LEASH_RPC_URL`       | **strongly recommended** | bring your own — see below                    |
   | `LEASH_EXPLORER_URL`  | no                       | `https://explorer.leash.market` (default)     |
   | `LEASH_API_KEY`       | no                       | legacy bearer for `/v1/payment-links`         |
   | `LEASH_PER_CALL_USDC` | no                       | per-call spend cap (default `1`)              |
   | `LEASH_PER_DAY_USDC`  | no                       | per-day spend cap (default `10`)              |

> **Bring your own RPC.** The default endpoints
> (`api.devnet.solana.com`, `api.mainnet-beta.solana.com`) are public,
> rate-limited, and slow. Each `leash_pay_payment_link` makes 3-5
> RPC calls — on a public endpoint that's a 4-8s settlement, sometimes
> a 429. Set `LEASH_RPC_URL` (or `rpc_url` in `agent.json`) to a
> Helius / Triton / QuickNode / Alchemy / self-hosted endpoint and
> settlement drops under one second.

The server **starts without** an agent configured — `tools/list`
still works, but every tool short-circuits with a `no_agent` JSON
blob asking the LLM to onboard the user. (The frictionless
`leash_register_agent` tool ships in the next release.)

`agent.json` example:

```jsonc
{
  "version": 1,
  "agent_mint": "Agnt7XQ...",
  "executive_keypair": "5Jz...", // base58 OR a 64-element JSON array
  "network": "solana-devnet",
  "rpc_url": "https://devnet.helius-rpc.com/?api-key=YOUR_KEY",
  "explorer_url": "https://explorer.leash.market",
  "created_at": "2026-04-30T...",
}
```

## Tools (17 canonical)

| Tool                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leash_register_agent`         | Two-step onboarding (call this tool TWICE). Step 1: collect agent name + description + image_url + EIP-8004 `services[]` from the user, persist them alongside a generated/imported executive keypair, return `funding_required`. Step 2: after the user funds the executive with SOL, mint MPL Core agent, set unlimited USDC delegation, record on the API, and HOT-SWAP the in-memory MCP host so subsequent tool calls work without a restart. |
| `leash_get_identity`           | Self-introspection — what agent am I, on which network, what's my treasury PDA.                                                                                                                                                                                                                                                                                                                                                                    |
| `leash_resolve_identity`       | Resolve another agent by mint, handle, or verified domain. Returns public profile, verified domains, public capability cards, public claims, and reputation summary.                                                                                                                                                                                                                                                                               |
| `leash_verify_identity`        | Verify that a mint, handle, or domain resolves to a live Leash identity. Add intent/capability/thresholds to get an allow/warn/deny trust verdict before paying, trusting a claim, or calling a capability.                                                                                                                                                                                                                                        |
| `leash_check_treasury_balance` | Read SOL + USDC/USDG/USDT balances on the agent treasury PDA.                                                                                                                                                                                                                                                                                                                                                                                      |
| `leash_pay_payment_link`       | Probe an x402/MPP link, sign + settle the SPL transfer locally, and return the receipt. Accepts `method` + `body` for POST paywalls.                                                                                                                                                                                                                                                                                                               |
| `leash_create_payment_link`    | Mint an x402/MPP paywall the user can share. Set `upstream_url` to monetize an existing API and `expected_request_body` to document POST body metadata. Requires `LEASH_API_KEY` until X-Leash-Sig auth lands.                                                                                                                                                                                                                                     |
| `leash_withdraw_treasury`      | Owner-driven withdrawal of SOL or an SPL stable to any wallet (mpl-core::Execute).                                                                                                                                                                                                                                                                                                                                                                 |
| `leash_set_spend_limit`        | Owner-driven update of the SPL `Approve` delegation that lets the executive spend stables from the treasury. `mode: 'unlimited' \| 'revoke' \| 'amount'` — tighten, pause, or restore the cap.                                                                                                                                                                                                                                                     |
| `leash_get_spend_limit`        | Read the current SPL delegation + treasury balance for a stable. Reports delegate, remaining cap (atomic + decimal), and balance.                                                                                                                                                                                                                                                                                                                  |
| `leash_receipts`               | Paginated receipts feed for the active agent. Requires `LEASH_API_KEY` until X-Leash-Sig auth lands.                                                                                                                                                                                                                                                                                                                                               |
| `leash_get_receipt`            | Fetch a single ReceiptV1 by `receipt_hash` — same canonical JSON the explorer renders at `/receipt/{hash}` (full price legs, request URL, decision, tx_sig, prev/current chain).                                                                                                                                                                                                                                                                   |
| `leash_transaction_history`    | List every earn + spend receipt in the last N days (default 7) plus running USD totals (`total_sent_usd`, `total_received_usd`, `net_usd`). Stables (USDC/USDG/USDT) summed at 1:1.                                                                                                                                                                                                                                                                |
| `leash_daily_transactions`     | Bin the same window into per-day buckets `[{ date, sent_usd, received_usd, net_usd, sent_count, received_count }]` plus grand totals — structured P&L view.                                                                                                                                                                                                                                                                                        |
| `leash_discover`               | Search the Leash marketplace and pay.sh/pay-skills registry for paid services by capability + price. Public read — works without an agent.                                                                                                                                                                                                                                                                                                         |
| `leash_pay_skills_endpoints`   | Expand a pay.sh/pay-skills provider into payable endpoint URLs.                                                                                                                                                                                                                                                                                                                                                                                    |
| `leash_reputation`             | Live reputation snapshot for any on-chain agent — settled-call volume, dispute rate, distinct counterparties. Public read.                                                                                                                                                                                                                                                                                                                         |

## Subcommands (cross-interface portability)

The CLI is more than the STDIO server — `leash-mcp` has a small set
of subcommands so an agent can move freely between hosts:

```bash
leash-mcp                  # default — run the STDIO MCP server
leash-mcp export           # print active agent.json to stdout
leash-mcp export --out a.json   # save instead
leash-mcp import path/to/agent.json  # install into ~/.config/leash/
leash-mcp doctor           # config + RPC + API reachability check
leash-mcp help             # full help
```

Use `export` + `import` to roam: an agent minted from Cursor's MCP
can be `export`ed, dropped into Claude Desktop, and `import`ed into
its config — same on-chain identity, same treasury, same reputation.
Same JSON also pastes cleanly into the chat product's
_Profile → Agent → Import_ page (forthcoming).

## Hosted paywalls for existing APIs

`leash_create_payment_link` can create a hosted `/x/{id}` URL in front of an API
you already run:

```json
{
  "label": "Design agent",
  "amount": 1,
  "currency": "USDC",
  "method": "POST",
  "protocol": "x402",
  "upstream_url": "https://api.example.com/design",
  "expected_request_body": {
    "prompt": "string",
    "style": "string",
    "format": "string"
  }
}
```

`expected_request_body` is discovery metadata only. The buyer agent sends the
real JSON body later through `leash_pay_payment_link`:

```json
{
  "url": "https://api.leash.market/x/design-agent?network=solana-devnet",
  "method": "POST",
  "body": "{\"prompt\":\"Design a landing page\",\"style\":\"premium dark mode\"}"
}
```

After settlement, Leash forwards that buyer body to `upstream_url` and returns
the upstream response.

Use `protocol: "mpp"` when the hosted paywall should speak the MPP
problem+json flow instead of x402's HTTP 402 flow.

## Try the read path

After provisioning an agent with `leash_register_agent` (or `leash agent create`),
poke balances through the MCP protocol directly:

```bash
LEASH_AGENT_MINT=<mint> \
LEASH_EXECUTIVE_KEY=<base58 secret> \
LEASH_NETWORK=solana-mainnet \
pnpm --filter @leashmarket/mcp dev:demo-balance
```

That bypasses STDIO and uses an in-memory transport — fastest way
to verify the path before recording a real demo.

## Develop

```bash
pnpm --filter @leashmarket/mcp typecheck
pnpm --filter @leashmarket/mcp test
pnpm --filter @leashmarket/mcp build
```

The compiled `dist/cli.js` is set executable (`chmod +x`) by the
build script so `npx -y @leashmarket/mcp` works without an extra step.
