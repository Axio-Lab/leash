# Leash — Surface reference

Read SKILL.md first. This file is the surface map you grep when the
agent asks "which package / route / env var does X?".

## SDK packages (`@leashmarket/*`)

| Package                       | Headline export                                                                                                                        | Use it for                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@leashmarket/core`           | `Policy.evaluate`, `hashReceipt`, `chainReceipt`                                                                                       | Pure policy + receipt primitives. No I/O. Used by buyer + seller + runner alike.                                                                        |
| `@leashmarket/seller-kit`     | `createSeller(app, opts)`                                                                                                              | Mounts the real `@x402/hono` middleware on a Hono app. PayTo = treasury PDA.                                                                            |
| `@leashmarket/buyer-kit`      | `createBuyer({ agent, signer, ... })`                                                                                                  | Returns a `fetch`-shaped function that runs policy + signs x402 transfers + finalises receipts.                                                         |
| `@leashmarket/registry-utils` | `createAgent`, `prepareAgentMint`, `getSpendDelegation`, `prepareSetSpendDelegation`, `findAssetSignerPda`                             | Mint MIP-104 agents, derive treasury, manage delegations.                                                                                               |
| `@leashmarket/runner`         | `leash-runner` CLI / `createRunner`                                                                                                    | HTTP service hosting JSONL receipt feed + payment-link endpoints + kill switch.                                                                         |
| `@leashmarket/facilitator`    | `leash-facilitator` CLI                                                                                                                | Run your own x402 facilitator (devnet in v0.1).                                                                                                         |
| `@leashmarket/schemas`        | `ReceiptV1Schema`, `RulesV1Schema`, etc.                                                                                               | Zod + JSON-Schema for every wire shape.                                                                                                                 |
| `@leashmarket/testing`        | `leash-conformance` CLI, in-memory facilitator                                                                                         | Conformance tests + offline fixtures.                                                                                                                   |
| `@leashmarket/sdk`            | `LeashClient` (`discover`, `reputation`, `receipts`, `getReceipt`, `transactionHistory`, `dailyTransactions`, payment-links, webhooks) | Typed wrapper over `api.leash.market`. Browser/Bun/Deno-friendly; agent-signed + legacy bearer auth. Supports `metadata.upstream_url` on payment links. |
| `@leashmarket/mcp`            | `leash-mcp` STDIO MCP server, `mintAgentLocally`                                                                                       | Drop the 17-tool Leash MCP into Cursor / Claude / Cline / etc. Settles in-process.                                                                      |
| `@leashmarket/cli`            | `leash` terminal CLI                                                                                                                   | Human-driven wrapper over the same `LeashHost`. `--json` for scripting.                                                                                 |
| `@leashmarket/mcp-core`       | `LeashHost`, `LEASH_TOOLS`, `defineTool`                                                                                               | Host-agnostic core every Leash MCP surface implements. Author new tools here.                                                                           |

## HTTPS API — `https://api.leash.market`

OpenAPI 3.1 lives at `/openapi.json`. Base URL is the same for both
networks; the API key prefix decides the cluster (`lsh_test_*` →
devnet, `lsh_live_*` → mainnet).

### Health & meta

- `GET /v1/health` — also returns a `protocol_fee` block:
  `{ bps, pct, authorities: { 'solana-mainnet', 'solana-devnet' } }`.
  Mirrors the same block on `@leashmarket/facilitator` `/health`.
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

**`POST /v1/submit` is required for explorer tracking.** It is the
step that creates the event row keyed by `event_id`, broadcasts the
transaction, and watchlists the agent so the indexer surfaces receipts
and on-chain activity on `explorer.leash.market`. A transaction sent via
raw RPC (outside this endpoint) produces no event row, no receipt, and
nothing on the explorer.

Prepare routes (mirror SDK `prepare*` helpers):

- `POST /v1/agents/prepare`
- `POST /v1/agents/{mint}/delegation/prepare` → SPL `Approve` to executive. Pass `pad_for_protocol_fee: true` to gross-up the allowance by the live Leash fee bps; the response echo includes `fee_padding_atoms` so the caller can audit.
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
- Public path `/x/{id}?network=solana-devnet` — what you share with buyers; returns 402 + `payment-required` for unpaid calls, then 200 once settled.
- To monetize an existing API, include `metadata.upstream_url` on the payment link. After settlement, Leash forwards the paid request to that upstream URL and returns the live upstream response. Without `metadata.upstream_url`, it returns the configured `response.body` template.
- CLI/MCP/Agent surfaces expose the same path as `--upstream-url` / `upstream_url` plus `method: GET|POST`.

### Seller utilities (HTTP parity with `@leashmarket/seller-kit` helpers)

- `GET  /v1/seller/networks` — supported network slugs + facilitator URLs + accepted currencies.
- `GET  /v1/seller/facilitator` — currently configured facilitator for a given network.
- `POST /v1/seller/parse-price` — turn `"$0.001"` into `{ amount, currency, asset }`.

### Buyer utilities (HTTP parity with `@leashmarket/buyer-kit`)

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
- `GET  /v1/receipts/{agent}?cursor=&limit=&kind=spend|earn` — paged feed for one agent.
- `GET  /v1/receipts/by-hash/{hash}` — single receipt by chain hash. Network is bound to the API key prefix; cross-network hashes return 404. Returns the canonical ReceiptV1 in `raw` (the same blob the explorer renders at `/receipt/{hash}`).
- `POST /v1/agents/{mint}/pull-target` — register a remote receipts URL the indexer will poll.

The MCP / CLI / SDK all expose helpers built on the receipts feed:

| Surface | Tool / Method                                                                 | What you get                                                                                                 |
| ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| MCP     | `leash_get_receipt`                                                           | Full ReceiptV1 by `receipt_hash` + explorer URL.                                                             |
| MCP     | `leash_transaction_history`                                                   | Receipts in the last N days (default 7) with USD totals (`total_sent_usd`, `total_received_usd`, `net_usd`). |
| MCP     | `leash_daily_transactions`                                                    | Per-day buckets `[{ date, sent_usd, received_usd, net_usd, sent_count, received_count }]`.                   |
| CLI     | `leash receipt <hash>` / `leash history` / `leash daily`                      | Plain-text or `--json` versions of the same.                                                                 |
| SDK     | `getReceipt(hash)` / `transactionHistory({...})` / `dailyTransactions({...})` | Typed responses (see `@leashmarket/sdk` types).                                                              |

Stables (USDC / USDG / USDT) are summed as USD 1:1 in the aggregate
helpers. Receipts in non-stable currencies are still counted but
excluded from the USD totals (`non_usd_count`).

### Indexer

- `GET /v1/indexer/status` — last cursor, watchlist size, network.

### Events (lifecycle + receipts + on-chain)

- `GET /v1/events/{id}`
- `GET /v1/events?kind=&agent=&cursor=&limit=`

Common `kind`s: `prepared`, `submitted`, `confirmed`, `failed`,
`receipt.published`, `receipt.pulled`, `payment_link.served`,
`payment_link.settled`, `treasury.funded`, `treasury.withdrawn`,
`protocol.fee.collected`.

`protocol.fee.collected` is emitted exactly once per settled `earn`
receipt that carries `price.fee` (and once per on-chain fee inflow when
the indexer sees the fee ATA receive funds). Metadata always includes
`{ fee_amount, gross_amount, net_amount, fee_bps, fee_authority,
currency, asset, receipt_hash, tx_sig? }`.

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
| `LEASH_API_KEY`                       | SDK         | Used by `@leashmarket/seller-kit` `onReceipt` default to forward receipts to the API.                                                               |
| `LEASH_API_FACILITATOR_URL`           | API server  | Override the facilitator URL the hosted paywall uses (default: `facilitator-devnet.leash.market` on devnet, `facilitator.leash.market` on mainnet). |
| `LEASH_API_ADMIN_SECRET`              | API server  | Bearer secret for `/v1/admin/*` routes.                                                                                                             |
| `LEASH_API_REDIS_URL`                 | API server  | Required for rate limits, idempotency, SSE Pub/Sub. Defaults to in-memory.                                                                          |
| `LEASH_FACILITATOR_SECRET_KEY`        | Facilitator | Solana keypair (JSON byte array OR base58). MUST be separate from any buyer key.                                                                    |
| `LEASH_FACILITATOR_NETWORKS`          | Facilitator | Comma list. Devnet only in v0.1.                                                                                                                    |
| `LEASH_FACILITATOR_PORT/HOST/RPC_URL` | Facilitator | HTTP listener + RPC override.                                                                                                                       |
| `LEASH_FEE_BPS`                       | Facilitator | Override the protocol fee rate (default `100` = 1.00%). Set on the API server too if you self-host.                                                 |
| `LEASH_FEE_ENFORCE`                   | Facilitator | `enforce` (default), `warn`, or `off`. Controls whether a missing or malformed fee leg is rejected, logged, or silently accepted.                   |
| `LEASH_FEE_AUTHORITY_MAINNET`         | Facilitator | Override the mainnet fee authority pubkey (default `3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W`). API server reads the same env.                  |
| `LEASH_FEE_AUTHORITY_DEVNET`          | Facilitator | Same, for devnet.                                                                                                                                   |
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
| Leash devnet facilitator  | `https://facilitator-devnet.leash.market` (SDK + API default) |
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
  `@leashmarket/seller-kit` and re-run; the buyer-kit will populate
  `receipt.price` from the echoed requirements.
- **"My withdraw signed but didn't show on the explorer."** Run the
  withdraw via `apps/api/scripts/withdraw.ts` (or `POST /v1/agents/{mint}/treasury/withdraw/prepare` → sign → `POST /v1/submit`), not a raw RPC call. **`POST /v1/submit` is what writes the event row and watchlists the agent**; the indexer only tracks activity for watchlisted agents.
- **"My transaction confirmed on-chain but nothing shows in the explorer or receipt feed."** You broadcast via raw RPC instead of `POST /v1/submit`. The API is unaware of the transaction — there is no event row and no explorer entry. Always use the prepare → sign → submit path through `api.leash.market`.
- **"My `e2e-devnet.ts` doesn't update fund/withdraw on the explorer but `withdraw.ts` does."** The e2e script bypasses the API; the explorer indexer only sees activity for watchlisted agents. Add a one-line API call (any `prepare*` works) to enrol the agent, or run the dedicated scripts.
- **"Local facilitator rejects my settle."** The facilitator's `LEASH_FACILITATOR_SECRET_KEY` MUST be a different keypair from the buyer-side signer. Generate one with `solana-keygen new -o .leash-fee-payer.json`, fund 0.05 SOL, restart.
- **"Token-2022 (USDG) transfers fail."** Use `TOKEN_2022_PROGRAM_ID`, not `TOKEN_PROGRAM_ID`. The seller/buyer kits handle this; raw SPL calls don't.
- **"My agent runs out of allowance one call early."** You forgot the
  1% Leash protocol fee — the buyer signs `gross = amount + fee`, not
  `amount`. Re-approve via `/v1/agents/{mint}/delegation/prepare` with
  `pad_for_protocol_fee: true`, or compute the gross-up yourself via
  `applyFeeGrossUp` from `@leashmarket/core`. Same fix applies to "treasury
  balance is short by ~1%".
- **"Where do my fees go?"** A single Leash-owned wallet on both
  clusters: `3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W`. Confirm via
  `GET /v1/health` (`protocol_fee.authorities`) before signing. Fee
  inflows show up as `protocol.fee.collected` events in the explorer.

## Where the canonical docs live

- Site: <https://docs.leash.market>
- LLM-friendly index: <https://docs.leash.market/llms.txt>
- Whole site as one Markdown file: <https://docs.leash.market/llms-full.txt>
- Any single page as Markdown: append `.md` to the URL.
- Repo: <https://github.com/leash-market/leash> (`apps/`, `packages/`, `skills/`).
