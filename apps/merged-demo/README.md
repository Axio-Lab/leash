# `@leash/merged-demo`

The full `buyer ↔ seller ↔ runner` loop in a single process. Useful for
dev, smoke tests, and as the simplest possible example of how the three
Leash kits fit together against real x402 on Solana devnet.

What it does on boot:

1. Spins up a Hono app with `@leash/seller-kit` mounted on `POST /echo`
   (real x402 middleware → `facilitator.svmacc.tech`).
2. If `LEASH_BUYER_SECRET_KEY` is set, also constructs a
   `@leash/buyer-kit` instance with that signer and tickles the seller every
   20 s. Each tick pays 0.001 USDC on devnet and emits both a `spend`
   (buyer) and `earn` (seller) receipt to the runner.
3. If the secret is not set, only the seller runs — the demo will still
   respond `402 + PAYMENT-REQUIRED` so you can probe it from elsewhere
   (e.g. the buyer playground in the web app).

## Prerequisites

Same as `@leash/buyer-demo` for the buyer half:

1. A devnet keypair (`solana-keygen new`) funded with devnet SOL
   (<https://faucet.solana.com>) and devnet USDC
   (<https://faucet.circle.com>, mint
   `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).
2. A Core asset mint for `AGENT_ASSET` (created via the web playground).

## Run

```bash
export LEASH_BUYER_SECRET_KEY="$(cat ~/.config/solana/leash-buyer.json)"
export SOLANA_RPC=https://api.devnet.solana.com
export AGENT_ASSET=<your Core asset mint>
export RUNNER_URL=http://localhost:8787
export PORT=3003

pnpm --filter @leash/merged-demo build
pnpm --filter @leash/merged-demo start
```

You should see:

```
merged-demo seller+buyer on :3003
merged buyer 200
merged buyer 200
…
```

Each `200` is a real x402 settlement on devnet. Inspect the `tx_sig` in the
runner UI (`/agents/<asset>` in the web app) → Solscan link.

## Environment

| Var                      | Default                         | Description                                                                                                                                                                                                                |
| ------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LEASH_BUYER_SECRET_KEY` | _optional_                      | If set, runs the buyer loop too.                                                                                                                                                                                           |
| `PORT`                   | `3003`                          | Port to bind.                                                                                                                                                                                                              |
| `SOLANA_RPC`             | `https://api.devnet.solana.com` | RPC the buyer signs against.                                                                                                                                                                                               |
| `AGENT_ASSET`            | `1111…1111`                     | Core asset mint shared by both sides.                                                                                                                                                                                      |
| `RUNNER_URL`             | `http://localhost:8787`         | Receipt destination.                                                                                                                                                                                                       |
| `LEASH_FACILITATOR_URL`  | _network default_               | Facilitator the **seller half** uses to verify and settle. Both `spend` (buyer) and `earn` (seller) receipts will record the resolved URL. See [Run a Facilitator](../docs/guides/run-a-facilitator.mdx) for self-hosting. |

### Routing through the Leash facilitator

Because both halves run in this single process, flipping
`LEASH_FACILITATOR_URL` swaps the entire settlement path in one go:

```bash
# Hosted (devnet, when DNS is live)
export LEASH_FACILITATOR_URL=https://facilitator.leash.market

# Self-hosted: requires apps/facilitator running in another terminal
export LEASH_FACILITATOR_URL=http://localhost:8787
```

This is the fastest way to smoke-test a brand-new facilitator deploy:
boot it, point the merged demo at it, and watch real `spend`/`earn`
pairs flow through against devnet.

### What the 1% Leash protocol fee looks like in this loop

Because `merged-demo` exercises the full buyer→facilitator→seller flow
in a single process, it's the easiest place to actually _see_ both legs
of a Leash settlement land:

- The seller-quoted price stays at `0.001 USDC` (the seller-net amount).
- The Leash facilitator appends a second `TransferChecked` for
  `0.00001 USDC` (the 1% fee leg) so the buyer signs `0.00101 USDC`.
- The runner receives **two** receipts per tick:
  - the `spend` receipt from the buyer (with `price.fee` /
    `price.gross` populated) and
  - the `earn` receipt from the seller (with the same fee block plus
    `price.feeAuthority`).
- The runner / explorer also records one
  `protocol.fee.collected` event per settled tick — see the explorer's
  "Protocol fees" panel and the
  [`apps/docs/api/protocol-fee.mdx`](../../apps/docs/api/protocol-fee.mdx)
  spec for the wire shape.

Vanilla x402 facilitators (no `protocol_fee` block on `/health`) keep
working unchanged: the buyer signs `0.001 USDC` flat and no fee leg
appears in the transaction.
