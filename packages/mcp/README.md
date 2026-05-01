# @leash/mcp

Standalone Leash MCP server. Lets any AI agent in any MCP host
(Cursor, Claude Desktop, Cline, Continue, ChatGPT-MCP, …) sign
on-chain Solana transactions, pay x402 paywalls, and check its
treasury balance — without a browser in the loop.

## Install

```jsonc
// In Cursor → Settings → MCP, or your MCP host's equivalent:
{
  "mcpServers": {
    "leash": {
      "command": "npx",
      "args": ["-y", "@leash/mcp"],
    },
  },
}
```

## Configure

The server looks at, in order:

1. `~/.config/leash/agent.json` (chmod 600). Same posture as
   `gcloud`/`gh`/`aws`.
2. Environment variables (override the file when set):

   | env                   | required | example                                       |
   | --------------------- | -------- | --------------------------------------------- |
   | `LEASH_AGENT_MINT`    | yes      | `Agnt7XQ...`                                  |
   | `LEASH_EXECUTIVE_KEY` | yes      | `5Jz...` (base58) or `[12,34,...]` (JSON arr) |
   | `LEASH_NETWORK`       | no       | `solana-devnet` (default) / `solana-mainnet`  |
   | `LEASH_API_URL`       | no       | `https://api.leash.market` (default)          |
   | `LEASH_RPC_URL`       | no       | overrides the per-network default RPC         |
   | `LEASH_API_KEY`       | no       | legacy bearer for `/v1/payment-links`         |
   | `LEASH_PER_CALL_USDC` | no       | per-call spend cap (default `1`)              |
   | `LEASH_PER_DAY_USDC`  | no       | per-day spend cap (default `10`)              |

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
  "created_at": "2026-04-30T...",
}
```

## Tools (v0.1)

| Tool                           | What it does                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leash_register_agent`         | First-run onboarding. Mints a devnet agent via the Leash sandbox faucet, persists `agent.json`, and HOT-SWAPS the in-memory MCP host so subsequent tool calls work without a restart. |
| `leash_get_identity`           | Self-introspection — what agent am I, on which network, what's my treasury PDA.                                                                                                       |
| `leash_check_treasury_balance` | Read SOL + USDC/USDG/USDT balances on the agent treasury PDA.                                                                                                                         |
| `leash_pay_payment_link`       | Probe an x402 link, sign + settle the SPL transfer locally, return the receipt.                                                                                                       |
| `leash_create_payment_link`    | Mint an x402 paywall the user can share. Requires `LEASH_API_KEY` until X-Leash-Sig auth lands.                                                                                       |
| `leash_withdraw_treasury`      | Owner-driven withdrawal of SOL or an SPL stable to any wallet (mpl-core::Execute).                                                                                                    |
| `leash_receipts`               | List recent receipts for the active agent. Requires `LEASH_API_KEY` until X-Leash-Sig auth lands.                                                                                     |

## Try the read path

Spin up an agent via the API (`pnpm --filter @leash/api test:self-register-devnet`),
then poke balances through the MCP protocol:

```bash
LEASH_AGENT_MINT=<mint> \
LEASH_EXECUTIVE_KEY=<base58 secret> \
LEASH_NETWORK=solana-devnet \
pnpm --filter @leash/mcp dev:demo-balance
```

That bypasses STDIO and uses an in-memory transport — fastest way
to verify the path before recording a real demo.

## Develop

```bash
pnpm --filter @leash/mcp typecheck
pnpm --filter @leash/mcp test
pnpm --filter @leash/mcp build
```

The compiled `dist/cli.js` is set executable (`chmod +x`) by the
build script so `npx -y @leash/mcp` works without an extra step.
