# `@leash/seller-demo`

> **Headless path.** This is for self-hosted seller endpoints. The hosted
> browser playground at `apps/web/seller` is a **Payment-Link Builder**: it
> lets anyone declare a price + response in the UI and the runner serves
> them back as live `/x/<id>` x402 paywalls — no extra Node server needed.
> Use this CLI when you want to wire `@leash/seller-kit` into your own
> Hono / Express / Fastify app.

A minimal Hono server that mounts the real `@leash/seller-kit` middleware
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
2. The `@leash/runner` running so receipts have somewhere to go (otherwise
   the seller still works, you just won't see them in the explorer).

## Run

```bash
export SOLANA_RPC=https://api.devnet.solana.com
export AGENT_ASSET=<your Core asset mint>
export RUNNER_URL=http://localhost:8787
export PORT=3001

pnpm --filter @leash/seller-demo build
pnpm --filter @leash/seller-demo start
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
settle, run `@leash/buyer-demo` against this seller (see its README).

## Environment

| Var                     | Default                         | Description                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | `3001`                          | Port to bind.                                                                                                                                                                                                                                                                                                                                              |
| `SOLANA_RPC`            | `https://api.devnet.solana.com` | RPC for the seller's Umi instance.                                                                                                                                                                                                                                                                                                                         |
| `AGENT_ASSET`           | `1111…1111`                     | Core asset mint owning the receipts.                                                                                                                                                                                                                                                                                                                       |
| `RUNNER_URL`            | `http://localhost:8787`         | Where to ship `earn` receipts.                                                                                                                                                                                                                                                                                                                             |
| `LEASH_FACILITATOR_URL` | _network default_               | Facilitator the seller uses to verify and settle. Set to `https://facilitator.leash.dev` for the Leash-operated devnet facilitator (v0.1, devnet only) or `http://localhost:8787` to point at a local instance. Falls back to `defaultFacilitatorFor()` from `@leash/core/x402` when unset. See [Run a Facilitator](../docs/guides/run-a-facilitator.mdx). |

### Routing through the Leash facilitator

```bash
# Hosted (devnet, when DNS is live)
export LEASH_FACILITATOR_URL=https://facilitator.leash.dev

# Self-hosted: run the Leash facilitator app and point at it
pnpm --filter @leash/facilitator-app dev   # boots on :8787 by default
export LEASH_FACILITATOR_URL=http://localhost:8787
```

The seller-kit reads this env on startup and persists the resolved URL
into every `earn` ReceiptV1 (`receipt.facilitator_url`) so explorers
can independently re-verify the on-chain settlement.
