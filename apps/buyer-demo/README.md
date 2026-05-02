# `@leash/buyer-demo`

> **Headless path.** This CLI is for unattended runners (TEEs, server
> workers, GitHub-Actions cron). The hosted browser playground at
> `apps/playground/buyer` does the same thing but signs through the user's Privy
> embedded wallet acting as the agent's registered Executive (per
> Metaplex's [Run an Agent docs](https://www.metaplex.com/docs/agents/run-an-agent)),
> so no private key ever leaves the browser.

A small Node CLI that loops a real x402 buyer against a seller endpoint
(`POST /tag` by default) on **Solana devnet**. It now supports both:

- a seller base URL (`http://localhost:3001`) → calls `POST /tag`
- a direct Leash payment link (`http://localhost:3000/x/<id>`) → first
  resolves metadata with `fetchPaymentLinkMeta()` from `@leash/core`, then
  calls the discovered method/url

Each tick:

1. Loads a devnet keypair from `LEASH_BUYER_SECRET_KEY`.
2. Constructs a `@leash/buyer-kit` client (`createBuyer`) with that signer
   and a `RulesV1` policy.
3. Calls `buyer.fetch(...)`. The first response is `402` with a
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

| Var                                | Default                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LEASH_BUYER_SECRET_KEY`           | _required_                      | JSON byte array of a devnet keypair. Acts as the agent's **executive** signer.                                                                                                                                                                                                                                                                                                                                                                   |
| `LEASH_BUYER_SOURCE_TOKEN_ACCOUNT` | _unset_                         | Optional. Agent treasury USDC ATA — funds debit from here when set, executive must already hold an SPL `Approve` delegation.                                                                                                                                                                                                                                                                                                                     |
| `SELLER_URL`                       | `http://localhost:3001`         | Seller base URL or direct Leash payment-link URL (`.../x/<id>`).                                                                                                                                                                                                                                                                                                                                                                                 |
| `RUNNER_URL`                       | `http://localhost:8787`         | `@leash/runner` base URL.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `AGENT_ASSET`                      | `1111…1111`                     | Core asset mint to attribute receipts to.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `SOLANA_RPC`                       | `https://api.devnet.solana.com` | RPC the buyer signs against.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POLL_MS`                          | `30000`                         | Interval between buyer ticks.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `LEASH_FACILITATOR_URL`            | _seller's choice_               | Override the facilitator the **seller** uses to verify and settle. Set to `https://facilitator.leash.market` to route through the Leash-operated devnet facilitator, or `http://localhost:8787` for a self-hosted one (see [Run a Facilitator](../../apps/docs/guides/run-a-facilitator.mdx)). The buyer never speaks to the facilitator directly — this is documented here because changing it on the seller flips it for the whole settlement. |

### Routing through the Leash facilitator

```bash
# Use the hosted Leash devnet facilitator (when DNS is live)
export LEASH_FACILITATOR_URL=https://facilitator.leash.market

# Or run one locally and point everything at it
export LEASH_FACILITATOR_URL=http://localhost:8787
pnpm --filter @leash/facilitator-app dev   # in another terminal
```

`@leash/buyer-kit` records the resolved facilitator URL on every
`ReceiptV1`, so you can confirm settlements went through the expected
infrastructure by inspecting `receipt.facilitator_url`.

### Agent-funded mode (recommended)

For the production "client funds the agent, the agent makes them money" flow:

1. Mint an agent (web playground or `createAgent` from `@leash/registry-utils`).
2. Approve the executive (this CLI's keypair) as the SPL delegate of the
   agent's USDC ATA via `setSpendDelegation` from `@leash/registry-utils`.
3. Fund the agent treasury PDA with USDC on devnet.
4. Set `LEASH_BUYER_SOURCE_TOKEN_ACCOUNT` to the printed
   `sourceTokenAccount` and run as usual. Every settled call now debits the
   agent treasury and decreases the remaining delegation.

> **Budget for the 1% Leash protocol fee.** Every settlement routed
> through a Leash facilitator (devnet or mainnet) appends a second
> `TransferChecked` for the fee leg, so a quote of `1.00 USDC` actually
> debits `1.01 USDC` from the agent treasury. When you set the SPL
> `Approve` allowance in step 2, gross-up your budget the same way — for
> example use `5.05 USDC` (atoms `5050000`) if you want to be able to
> consume `5 USDC` worth of seller-quoted endpoints. The web playground's
> _Set allowance_ button does this automatically; the
> `/v1/agents/{mint}/delegation/prepare` API exposes it as
> `pad_for_protocol_fee: true`. See
> [`apps/docs/api/protocol-fee.mdx`](../../apps/docs/api/protocol-fee.mdx)
> for the full math and the `extra['leash.fee']` wire shape.
