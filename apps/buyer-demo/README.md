# `@leash/buyer-demo`

> **Headless path.** This CLI is for unattended runners (TEEs, server
> workers, GitHub-Actions cron). The hosted browser playground at
> `apps/web/buyer` does the same thing but signs through the user's Privy
> embedded wallet acting as the agent's registered Executive (per
> Metaplex's [Run an Agent docs](https://www.metaplex.com/docs/agents/run-an-agent)),
> so no private key ever leaves the browser.

A small Node CLI that loops a real x402 buyer against a seller endpoint
(`POST /tag` by default) on **Solana devnet**. Each tick:

1. Loads a devnet keypair from `LEASH_BUYER_SECRET_KEY`.
2. Constructs a `@leash/buyer-kit` client (`createBuyer`) with that signer
   and a `RulesV1` policy.
3. Calls `buyer.fetch(SELLER_URL/tag)`. The first response is `402` with a
   `PAYMENT-REQUIRED` header; `@x402/fetch` builds and signs an SPL-USDC
   transfer, retries the request, and the seller settles via
   `facilitator.svmacc.tech`.
4. Posts the resulting `ReceiptV1` to the runner so the explorer feed
   updates in real time.

## Prerequisites

You need three things before running this demo:

1. **A devnet keypair** — generate one with
   `solana-keygen new --no-bip39-passphrase --outfile ~/.config/solana/leash-buyer.json`.
2. **Devnet SOL** — fund it from <https://faucet.solana.com> (a few hundred
   thousand lamports is plenty; SOL is only used for transaction fees because
   the facilitator pays the network fee on `payTo`).
3. **Devnet USDC** — Circle's official devnet USDC mint is
   `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Mint test USDC to your
   keypair via <https://faucet.circle.com>.

> Sanity check the balances:
>
> ```bash
> solana balance $(solana-keygen pubkey ~/.config/solana/leash-buyer.json) --url devnet
> spl-token --url devnet --owner ~/.config/solana/leash-buyer.json balance \
>   4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
> ```

## Run

```bash
# Encode the keypair as a JSON byte array env var
export LEASH_BUYER_SECRET_KEY="$(cat ~/.config/solana/leash-buyer.json)"

# Point at a local seller (e.g. apps/seller-demo) and the runner
export SELLER_URL=http://localhost:3001
export RUNNER_URL=http://localhost:8787
export AGENT_ASSET=11111111111111111111111111111111  # replace with a Core asset mint
export SOLANA_RPC=https://api.devnet.solana.com

pnpm --filter @leash/buyer-demo build
pnpm --filter @leash/buyer-demo start
```

You should see ticks like:

```
buyer tick 200 allow 9f7c2a01
```

Each one corresponds to a real x402 settlement on devnet. Inspect the
`tx_sig` from the receipt feed in the runner UI (`/agents/<asset>` in the web
app) to see it on Solscan.

## Environment

| Var                      | Default                         | Description                               |
| ------------------------ | ------------------------------- | ----------------------------------------- |
| `LEASH_BUYER_SECRET_KEY` | _required_                      | JSON byte array of a devnet keypair.      |
| `SELLER_URL`             | `http://localhost:3001`         | Base URL of the seller.                   |
| `RUNNER_URL`             | `http://localhost:8787`         | `@leash/runner` base URL.                 |
| `AGENT_ASSET`            | `1111…1111`                     | Core asset mint to attribute receipts to. |
| `SOLANA_RPC`             | `https://api.devnet.solana.com` | RPC the buyer signs against.              |
| `POLL_MS`                | `30000`                         | Interval between buyer ticks.             |
