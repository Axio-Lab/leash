# `@leashmarket/seller-demo`

> **Headless path.** This is for self-hosted seller endpoints. The hosted
> browser playground at `apps/playground/seller` is a **Payment-Link Builder**: it
> lets anyone declare a price + response in the UI and the runner serves
> them back as live `/x/<id>` x402 paywalls — no extra Node server needed.
> Use this CLI when you want to wire `@leashmarket/seller-kit` into your own
> Hono / Express / Fastify app.

A minimal Hono server that mounts the real `@leashmarket/seller-kit` middleware
(real x402 on Solana devnet) on `POST /tag`. Unauthenticated requests get
`402 + PAYMENT-REQUIRED`. Once a buyer settles via the configured
facilitator, the route runs the real handler and emits an `earn`
`ReceiptV1` to the runner.

## Prerequisites

The seller does **not** sign anything itself — settlement happens via the
facilitator, which pays the network fee and broadcasts the SPL transfer. You
only need:

1. A Core asset mint to act as `sellerAgent.asset`. The default is the
   placeholder `1111…1111` so you can boot without registering an agent
   first; for end-to-end receipts use a real Core asset created in the web
   playground (`/agents/new`).
2. The `@leashmarket/runner` running so receipts have somewhere to go (otherwise
   the seller still works, you just won't see them in the explorer).

## Run

```bash
export SOLANA_RPC=https://api.devnet.solana.com
export AGENT_ASSET=<your Core asset mint>
export RUNNER_URL=http://localhost:8787
export PORT=3001

pnpm --filter @leashmarket/seller-demo build
pnpm --filter @leashmarket/seller-demo start
```

You should see:

```
seller-demo on :3001
```

## Probing the seller without paying

The middleware always responds 402 to unpaid traffic. To inspect the offer:

```bash
curl -i -X POST http://localhost:3001/tag -d '{"hello":"leash"}'
```

The response headers include `PAYMENT-REQUIRED: <base64>` — decode it for
the `accepts[]` (asset mint, payTo PDA, amount, network). To actually
settle, run `@leashmarket/buyer-demo` against this seller (see its README).

## Environment

| Var                     | Default                         | Description                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | `3001`                          | Port to bind.                                                                                                                                                                                                                                                                                                                                                       |
| `SOLANA_RPC`            | `https://api.devnet.solana.com` | RPC for the seller's Umi instance.                                                                                                                                                                                                                                                                                                                                  |
| `AGENT_ASSET`           | `1111…1111`                     | Core asset mint owning the receipts.                                                                                                                                                                                                                                                                                                                                |
| `RUNNER_URL`            | `http://localhost:8787`         | Where to ship `earn` receipts.                                                                                                                                                                                                                                                                                                                                      |
| `LEASH_FACILITATOR_URL` | _network default_               | Facilitator the seller uses to verify and settle. Set to `https://facilitator.leash.market` for the Leash-operated devnet facilitator (v0.1, devnet only) or `http://localhost:8787` to point at a local instance. Falls back to `defaultFacilitatorFor()` from `@leashmarket/core/x402` when unset. See [Run a Facilitator](../docs/guides/run-a-facilitator.mdx). |

### Routing through the Leash facilitator

```bash
# Hosted (devnet, when DNS is live)
export LEASH_FACILITATOR_URL=https://facilitator.leash.market

# Self-hosted: run the Leash facilitator app and point at it
pnpm --filter @leashmarket/facilitator-app dev   # boots on :8787 by default
export LEASH_FACILITATOR_URL=http://localhost:8787
```

The seller-kit reads this env on startup and persists the resolved URL
into every `earn` ReceiptV1 (`receipt.facilitator_url`) so explorers
can independently re-verify the on-chain settlement.

### Pricing under the 1% Leash protocol fee

`@leashmarket/seller-kit` always **quotes you the net** — the price you set
when you wired the middleware is exactly what lands in your `payTo` ATA
on every settlement. The Leash facilitator gross-ups the buyer's signed
transaction with a second `TransferChecked` for the protocol fee, so
the buyer pays `amount + fee` while you pocket `amount`.

What that means for this demo:

- The price you advertise on `POST /tag` (e.g. `0.01 USDC`) is the
  **seller-net price**. No extra config required.
- The 402 response stamps `extra['leash.fee']` so buyers know the rate
  before they sign — this is what makes the gross-up agreed-upon
  rather than facilitator-imposed.
- Every emitted `earn` `ReceiptV1` includes `price.fee`, `price.gross`,
  `price.feeBps`, and `price.feeAuthority` so the runner / explorer can
  reconcile your earnings against on-chain fee inflows.
- Vanilla x402 callers (no Leash facilitator in the loop) still settle
  for `amount` flat — the fee leg is only enforced when the
  facilitator advertises Leash semantics on `/health`.

See [`apps/docs/api/protocol-fee.mdx`](../../apps/docs/api/protocol-fee.mdx)
for the wire-shape spec and `LEASH_FEE_ENFORCE` cutover guidance.
