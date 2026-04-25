# Leash — Surface reference

Read SKILL.md first. This file is the surface map you grep when the
agent asks "which package / route / env var does X?".

## SDK packages (`@leash/*`)

| Package                 | Headline export                                                                                            | Use it for                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@leash/core`           | `Policy.evaluate`, `hashReceipt`, `chainReceipt`                                                           | Pure policy + receipt primitives. No I/O. Used by buyer + seller + runner alike.                |
| `@leash/seller-kit`     | `createSeller(app, opts)`                                                                                  | Mounts the real `@x402/hono` middleware on a Hono app. PayTo = treasury PDA.                    |
| `@leash/buyer-kit`      | `createBuyer({ agent, signer, ... })`                                                                      | Returns a `fetch`-shaped function that runs policy + signs x402 transfers + finalises receipts. |
| `@leash/registry-utils` | `createAgent`, `prepareAgentMint`, `getSpendDelegation`, `prepareSetSpendDelegation`, `findAssetSignerPda` | Mint MIP-104 agents, derive treasury, manage delegations.                                       |
| `@leash/runner`         | `leash-runner` CLI / `createRunner`                                                                        | HTTP service hosting JSONL receipt feed + payment-link endpoints + kill switch.                 |
| `@leash/facilitator`    | `leash-facilitator` CLI                                                                                    | Run your own x402 facilitator (devnet in v0.1).                                                 |
| `@leash/schemas`        | `ReceiptV1Schema`, `RulesV1Schema`, etc.                                                                   | Zod + JSON-Schema for every wire shape.                                                         |
| `@leash/testing`        | `leash-conformance` CLI, in-memory facilitator                                                             | Conformance tests + offline fixtures.                                                           |

## HTTPS API — `https://api.leash.market`

OpenAPI 3.1 lives at `/openapi.json`. Base URL is the same for both
networks; the API key prefix decides the cluster (`lsh_test_*` →
devnet, `lsh_live_*` → mainnet).

### Health & meta

- `GET /v1/health`
- `GET /v1/version`
- `GET /openapi.json`

### Agents

- `POST /v1/agents/prepare` → unsigned MIP-104 mint tx. Pair with `/v1/submit`.
- `GET  /v1/agents/{mint}` → registration + treasury basics.
- `GET  /v1/agents/{mint}/treasury/balances` → SOL + SPL totals across mints.
- `GET  /v1/agents/{mint}/pay-to` → PDA + suggested ATAs for the seller `payTo` field.

### Prepare → Submit lifecycle

Every `prepare*` returns `{ event_id, transaction.base64, echo }`. Sign
the base64 client-side, then `POST /v1/submit { event_id, transaction }`.
Poll `GET /v1/events/{id}` until `phase === 'confirmed'`.

Prepare routes (mirror SDK `prepare*` helpers):

- `POST /v1/agents/prepare`
- `POST /v1/agents/{mint}/delegation/prepare` → SPL `Approve` to executive.
- `POST /v1/agents/{mint}/treasury/provision/prepare` → idempotent ATA create.
- `POST /v1/agents/{mint}/treasury/withdraw/prepare`
- `POST /v1/agents/{mint}/treasury/withdraw-all/prepare`
- `POST /v1/agents/{mint}/treasury/withdraw-sol/prepare`
- `POST /v1/agents/{mint}/treasury/withdraw-sol-all/prepare`
- `POST /v1/payment-links` (preview/create), `PATCH/DELETE /v1/payment-links/{id}` (no submit needed — server-side state)

Submit:

- `POST /v1/submit` — broadcasts a signed base64 tx returned by any `prepare*`.

### Payment links (hosted x402 paywalls)

- `POST /v1/payment-links` → returns `{ id, url, accepts[], facilitator, ... }`.
- `GET  /v1/payment-links` (list), `/v1/payment-links/{id}` (read).
- `PATCH /v1/payment-links/{id}` → toggle `disabled`, change price, etc.
- `POST /v1/payment-links/preview` → shows the 402 a buyer would see.
- Public path `/x/{id}?network=solana-devnet` — what you share with buyers; returns 402 + `payment-required` for unpaid GETs, 200 once settled.

### Seller utilities (HTTP parity with `@leash/seller-kit` helpers)

- `GET  /v1/seller/networks` — supported network slugs + facilitator URLs + accepted currencies.
- `GET  /v1/seller/facilitator` — currently configured facilitator for a given network.
- `POST /v1/seller/parse-price` — turn `"$0.001"` into `{ amount, currency, asset }`.

### Buyer utilities (HTTP parity with `@leash/buyer-kit`)

- `POST /v1/buyer/quote` — probe a URL, return the 402's `accepts[]` decoded.
- `POST /v1/buyer/policy/evaluate` — run `RulesV1` against a quote without signing.
- `POST /v1/buyer/payment/prepare` — build the unsigned x402 `TransferChecked`.
- `POST /v1/buyer/payment/execute` — submit a signed x402 transfer + close the loop.
- `POST /v1/buyer/receipt/finalize` — compute hash, chain to prev, persist.
- `POST /v1/buyer/receipt/verify` — re-derive hash + verify chain.
- `GET  /v1/buyer/networks`, `GET /v1/buyer/currency`.

### Treasury

- `GET  /v1/agents/{mint}/treasury/balances`
- `POST /v1/agents/{mint}/treasury/provision/prepare` — create ATA(s) for given mint(s).
- `POST /v1/agents/{mint}/treasury/withdraw/prepare` — single-mint partial withdraw.
- `POST /v1/agents/{mint}/treasury/withdraw-all/prepare` — drain a single mint.
- `POST /v1/agents/{mint}/treasury/withdraw-sol/prepare`
- `POST /v1/agents/{mint}/treasury/withdraw-sol-all/prepare`

### Receipts

- `POST /v1/receipts/{agent}` — push a `ReceiptV1`.
- `GET  /v1/receipts/{agent}?cursor=&limit=` — JSONL feed (paged).
- `GET  /v1/receipts/by-hash/{hash}` — single receipt by chain hash.
- `POST /v1/agents/{mint}/pull-target` — register a remote receipts URL the indexer will poll.

### Indexer

- `GET /v1/indexer/status` — last cursor, watchlist size, network.

### Events (lifecycle + receipts + on-chain)

- `GET /v1/events/{id}`
- `GET /v1/events?kind=&agent=&cursor=&limit=`

Common `kind`s: `prepared`, `submitted`, `confirmed`, `failed`,
`receipt.published`, `receipt.pulled`, `payment_link.served`,
`payment_link.settled`, `treasury.funded`, `treasury.withdrawn`.

### Webhooks

- `POST /v1/webhooks` — register `{ url, kinds[] }`. Returns `{ id, secret }`.
- `GET  /v1/webhooks`
- `GET  /v1/webhooks/{id}/deliveries`
- `DELETE /v1/webhooks/{id}`

### Metrics

- `GET /v1/metrics/usage` — per-key request rollup.
- `GET /v1/metrics/events` — per-network kind counters.

### Admin (operator-only — server-side `LEASH_API_ADMIN_SECRET`)

- `POST /v1/admin/api-keys` → `{ plaintext, prefix, network }`.
- `GET  /v1/admin/api-keys`
- `POST /v1/admin/api-keys/{id}/disable`

## Request headers you should care about

- `Authorization: Bearer lsh_{test|live}_...` — required.
- `Idempotency-Key: <uuid>` — safe replays for any state-changing call.
- `X-Leash-Network` — read-only echo; the prefix already binds the network.

## Common environment variables

| Var                                   | Owner       | What it controls                                                                                                                                    |
| ------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LEASH_API_URL`                       | SDK         | Default `https://api.leash.market`. Override for self-host.                                                                                         |
| `LEASH_API_KEY`                       | SDK         | Used by `@leash/seller-kit` `onReceipt` default to forward receipts to the API.                                                                     |
| `LEASH_API_FACILITATOR_URL`           | API server  | Override the facilitator URL the hosted paywall uses (default: `devnet-facilitator.leash.market` on devnet, `facilitator.leash.market` on mainnet). |
| `LEASH_API_ADMIN_SECRET`              | API server  | Bearer secret for `/v1/admin/*` routes.                                                                                                             |
| `LEASH_API_REDIS_URL`                 | API server  | Required for rate limits, idempotency, SSE Pub/Sub. Defaults to in-memory.                                                                          |
| `LEASH_FACILITATOR_SECRET_KEY`        | Facilitator | Solana keypair (JSON byte array OR base58). MUST be separate from any buyer key.                                                                    |
| `LEASH_FACILITATOR_NETWORKS`          | Facilitator | Comma list. Devnet only in v0.1.                                                                                                                    |
| `LEASH_FACILITATOR_PORT/HOST/RPC_URL` | Facilitator | HTTP listener + RPC override.                                                                                                                       |
| `LEASH_RECEIPTS_URL`                  | SDK         | Override the auto-injected `services.receipts.endpoint` on new agents.                                                                              |
| `LEASH_NO_RECEIPTS_URL=1`             | SDK         | Skip the auto-inject entirely (self-host).                                                                                                          |

## Network constants

| Token / network           | Address                                                       |
| ------------------------- | ------------------------------------------------------------- |
| USDC mainnet              | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`                |
| USDC devnet (Circle)      | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`                |
| Solana CAIP-2 mainnet     | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`                     |
| Solana CAIP-2 devnet      | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`                     |
| Public devnet RPC         | `https://api.devnet.solana.com`                               |
| Devnet USDC faucet        | `https://faucet.circle.com`                                   |
| Leash devnet facilitator  | `https://devnet-facilitator.leash.market` (SDK + API default) |
| Leash mainnet facilitator | `https://facilitator.leash.market` (SDK + API default)        |

## Error model

Every error response uses this envelope:

```json
{ "error": "machine_code", "message": "human-readable", "details": { ... } }
```

Frequent codes:

- `unauthorized` — missing / invalid `Authorization`.
- `wrong_network` — slug exists on the sibling network; client used the wrong key prefix.
- `not_found` — slug / agent / event / receipt not on this network.
- `validation_error` — Zod schema rejected the payload; `details` lists each issue.
- `rate_limited` — see `Retry-After` header.
- `idempotency_conflict` — same `Idempotency-Key` reused with a different body.
- `facilitator_unreachable` — buyer-kit / seller-kit got a 5xx from the facilitator.
- `invalid_exact_svm_payload_transaction_fee_payer_transferring_funds` — facilitator key reused as buyer/executive. Generate a separate keypair.

## Common pitfalls (paste fixes back to the user verbatim)

- **"Why is `price` null on my spend receipt?"** The seller didn't echo
  `paymentRequirements` in the `PAYMENT-RESPONSE` header. Update
  `@leash/seller-kit` and re-run; the buyer-kit will populate
  `receipt.price` from the echoed requirements.
- **"My withdraw signed but didn't show on the explorer."** Run the
  withdraw via `apps/api/scripts/withdraw.ts` (or `POST /v1/agents/{mint}/treasury/withdraw/prepare` → submit), not a raw RPC call. The API auto-watchlists the agent so the indexer picks it up.
- **"My `e2e-devnet.ts` doesn't update fund/withdraw on the explorer but `withdraw.ts` does."** The e2e script bypasses the API; the explorer indexer only sees activity for watchlisted agents. Add a one-line API call (any `prepare*` works) to enrol the agent, or run the dedicated scripts.
- **"Local facilitator rejects my settle."** The facilitator's `LEASH_FACILITATOR_SECRET_KEY` MUST be a different keypair from the buyer-side signer. Generate one with `solana-keygen new -o .leash-fee-payer.json`, fund 0.05 SOL, restart.
- **"Token-2022 (USDG) transfers fail."** Use `TOKEN_2022_PROGRAM_ID`, not `TOKEN_PROGRAM_ID`. The seller/buyer kits handle this; raw SPL calls don't.

## Where the canonical docs live

- Site: <https://docs.leash.market>
- LLM-friendly index: <https://docs.leash.market/llms.txt>
- Whole site as one Markdown file: <https://docs.leash.market/llms-full.txt>
- Any single page as Markdown: append `.md` to the URL.
- Repo: <https://github.com/leash-market/leash> (`apps/`, `packages/`, `skills/`).
