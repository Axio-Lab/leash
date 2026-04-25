# `apps/api/scripts`

Operational scripts for the Leash API. Anything that pokes a _real_ network
(devnet or mainnet) lives here, never in `tests/` (which always runs hermetic).

## `e2e-devnet.ts`

End-to-end smoke test that drives every payment-link / paywall / receipt
endpoint exposed by `@leash/api` against a _real_ Leash API process and a
_real_ Solana devnet, and verifies the resulting state.

What it covers (in order):

1. `GET /v1/health`
2. seller utilities — `/v1/seller/networks`, `/v1/seller/facilitator`,
   `POST /v1/seller/parse-price`
3. buyer utilities — `/v1/buyer/networks`, `/v1/buyer/currency`,
   `POST /v1/buyer/policy/evaluate`
4. agent resolution — mints two MPL-Core agents (seller + buyer) with
   `@leash/registry-utils` if `LEASH_E2E_SELLER_AGENT` /
   `LEASH_E2E_BUYER_AGENT` aren't supplied
5. `GET /v1/agents/{seller}/pay-to` — asserts the API derives the same Asset
   Signer PDA as the SDK
6. provisions USDC ATAs on both treasuries
7. tops up the buyer treasury USDC from the owner wallet (only if balance is
   below `LEASH_E2E_FUND_USDC`)
8. sets a fresh SPL spend delegation on the buyer treasury so the owner can
   sign on the agent's behalf
9. payment links — `POST /v1/payment-links/preview`,
   `POST /v1/payment-links`, `GET /v1/payment-links/{id}`
10. `POST /v1/buyer/quote` against the link's `share_url`
11. anonymous probe of `/x/{id}` — must return `402` with a
    `PAYMENT-REQUIRED` header
12. real x402 settlement via `createBuyer.fetch(share_url)` — submits a real
    USDC transfer on devnet, settles via the API's configured facilitator
13. asserts the link's `call_count` / `settled_count` / `last_tx_sig` were
    bumped, and that `payment_link.settled` + `receipt.published` events
    exist with the matching signature
14. asserts the `earn` receipt is visible at `/v1/receipts/{seller}` and
    via `/v1/receipts/by-hash/{hash}`
15. asserts `/v1/indexer/status` reports a healthy devnet entry
16. soft-disables the link unless `LEASH_E2E_KEEP_LINK=1`

Every API call goes through the same `Authorization: Bearer <api-key>`
surface a third-party SDK would use — there are no internal back-doors.

### Prerequisites

You need:

- A running Leash API on a reachable URL (default `http://localhost:8801`).
- An `lsh_test_*` API key for that API (issue via
  `POST /v1/admin/api-keys`, see [`docs/api/auth.mdx`](../../docs/api/auth.mdx)).
- A devnet wallet (private key) that:
  - holds enough SOL for ~5 transactions (mints + ATAs + settlement)
  - holds at least `LEASH_E2E_FUND_USDC` of devnet USDC if the buyer
    treasury isn't already funded (top up via
    [Circle's faucet](https://faucet.circle.com))
- The API process must be configured with `LEASH_API_PUBLIC_ORIGIN` set to
  the same origin you're hitting (otherwise `share_url` won't match
  `LEASH_E2E_API_URL` and the script's anonymous-probe step will fail).

### Environment

Required:

| Var                      | What                                                |
| ------------------------ | --------------------------------------------------- |
| `LEASH_E2E_API_KEY`      | A devnet key issued via `/v1/admin/api-keys`.       |
| `LEASH_E2E_OWNER_SECRET` | Base58 string OR JSON-array (`[1,2,…]`) secret key. |

Optional (sensible defaults shown):

| Var                       | Default                                        | Notes                                                          |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| `LEASH_E2E_API_URL`       | `http://localhost:8801`                        | Base URL of the API (no trailing slash).                       |
| `LEASH_E2E_RPC`           | `https://api.devnet.solana.com`                | Devnet RPC for `umi` + `createBuyer`.                          |
| `LEASH_E2E_USDC_MINT`     | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Circle's official devnet USDC.                                 |
| `LEASH_E2E_PRICE`         | `$0.001`                                       | Display price; must round-trip to a non-zero atomic amount.    |
| `LEASH_E2E_AGENT_URI`     | `https://leash.market/test-agent.json`         | Used when minting fresh agents.                                |
| `LEASH_E2E_SELLER_AGENT`  | —                                              | Reuse an existing seller asset (skip mint).                    |
| `LEASH_E2E_BUYER_AGENT`   | —                                              | Reuse an existing buyer asset (skip mint).                     |
| `LEASH_E2E_FUND_USDC`     | `100000` (= 0.1 USDC)                          | Atomic units to top up the buyer treasury to.                  |
| `LEASH_E2E_DELEGATE_USDC` | `100000`                                       | Atomic units the SPL `approve` allowance should cover.         |
| `LEASH_E2E_KEEP_LINK`     | `0`                                            | `1` to skip soft-disable so you can poke the link in explorer. |

A starter env file lives at [`apps/api/.env.e2e.example`](../.env.e2e.example).
Copy it to `.env.e2e` and fill in the secret + key.

### Run it

From the repo root:

```bash
# 1. start the API in another terminal (devnet by default)
pnpm --filter @leash/api dev

# 2. issue a devnet key once (see docs/api/auth.mdx); copy the value into .env.e2e

# 3. run the e2e
cp apps/api/.env.e2e.example apps/api/.env.e2e
$EDITOR apps/api/.env.e2e
pnpm --filter @leash/api e2e:devnet
```

`pnpm --filter @leash/api e2e:devnet` is wired to:

```bash
node \
  --env-file-if-exists=.env \
  --env-file-if-exists=.env.e2e \
  --import tsx \
  ./scripts/e2e-devnet.ts
```

so any value in `apps/api/.env.e2e` overrides `apps/api/.env`, and explicit
shell exports override both.

### Inspect the result

After a successful run the script prints something like:

```
============================================================
✓ end-to-end devnet run completed
============================================================
payment link  : http://localhost:8801/x/01J…
tx signature  : https://solscan.io/tx/5xY…?cluster=devnet
seller agent  : 9aGq…
buyer  agent  : H8nP…
```

Open the explorer (`pnpm --filter @leash/explorer dev`) at:

- `/payment-links/<link-id>` — counters + last paid signature
- `/agents/<seller>` — earn receipts feed
- `/agents/<buyer>` — spend receipts feed (when `onReceipt: true`)
- `/tx/<tx_sig>` — the underlying SPL transfer

### Re-running

The script is idempotent on the chain side:

- Existing agents are reused via `LEASH_E2E_SELLER_AGENT` / `LEASH_E2E_BUYER_AGENT`.
- ATAs are only created if missing (`provisionTreasuryAtas`).
- The buyer treasury is only topped up when `balance < LEASH_E2E_FUND_USDC`.
- A fresh delegation is only requested when the current allowance is too low.
- A _new_ payment link is created on each run (intentional — so explorer
  history grows). Set `LEASH_E2E_KEEP_LINK=1` if you want to poke at it.

### When it fails

| Symptom                                                | Likely cause                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `expected a devnet key (lsh_test_*), got "lsh_live_…"` | You tried to run e2e against a mainnet key. Don't.                                                                                 |
| `share_url … should start with API_URL …`              | API process has no `LEASH_API_PUBLIC_ORIGIN`, or it's set to a different origin than the one the script is hitting.                |
| `owner … USDC balance (…) < required (…)`              | Top up the owner wallet at [https://faucet.circle.com](https://faucet.circle.com).                                                 |
| `quote.chosen is null — wrong network on the API key?` | The API's seller config can't render an `accepts[]` for `solana-devnet` (check `/v1/seller/networks`).                             |
| `paywall should respond with 402 …`                    | API isn't actually serving `/x/{id}` (check `LEASH_API_PUBLIC_ORIGIN` and that the `apps/api` build is current).                   |
| `settlement failed; reason=…`                          | The buyer policy rejected the call, or the facilitator returned an error. The `decision` and `failureReason` are in the same line. |
| `settled_count never bumped`                           | Settlement reached the chain but the API's paywall handler didn't observe it; check API logs for `payment_link.settled` errors.    |
