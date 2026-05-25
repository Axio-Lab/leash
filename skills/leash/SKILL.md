---
name: leash
description: >-
  Build, monetise, and operate Solana agents that pay each other in real
  SPL stables (USDC / USDT / USDG) via the x402 protocol. Use whenever the
  user mentions Leash, leash.market, agent treasuries, x402, agent-to-agent
  payments, agent payment links, agent paywalls, MPL Core agents on Solana,
  monetise an API per call on Solana, or wants to build a buyer / seller /
  merged agent. Covers the @leashmarket/* SDK, the api.leash.market HTTPS surface,
  the prepare → sign → submit lifecycle, hosted payment links at /x/{id},
  the explorer at explorer.leash.market, the local facilitator, and the
  fund / withdraw flows on the agent treasury PDA.
---

# Leash — Agent payments on Solana via x402

Leash is the operating system for agent-to-agent commerce.

Leash gives every agent a wallet (an MPL Core asset whose **Asset Signer
PDA** is the treasury), a capped spend allowance the owner controls (an
SPL token delegation), real x402 settlement in USDC / USDT / USDG, and a
hash-chained `ReceiptV1` audit log. Buyer and seller are **capabilities
on the same identity** — one mint, two roles.

## Pick your surface

| You want to…                                             | Reach for                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Drive Leash from Python / Go / Rust / curl               | The HTTPS API at `api.leash.market` — see `REFERENCE.md`                                            |
| Ship a TS app with no remote dependency                  | The `@leashmarket/*` SDK packages — see `EXAMPLES.md`                                               |
| Charge per call on a SaaS endpoint you already host      | Hosted **payment links** with `metadata.upstream_url` and optional `metadata.expected_request_body` |
| Mount real x402 middleware on your own Hono app          | `@leashmarket/seller-kit` `createSeller`                                                            |
| Script an agent that pays an x402 endpoint               | `@leashmarket/buyer-kit` `createBuyer`                                                              |
| Mint a brand-new agent (asset + AgentIdentity) in one tx | `@leashmarket/registry-utils` `createAgent`, or `POST /v1/agents/prepare`                           |
| Inspect agents / receipts / events with a UI             | `https://explorer.leash.market`                                                                     |
| Settle locally without depending on hosted infra         | `@leashmarket/facilitator` (devnet) — see `REFERENCE.md`                                            |
| Drop Leash tools into a coding agent (Cursor / Claude)   | `@leashmarket/mcp` STDIO MCP — see "Agent surfaces" below                                           |
| Run agent ops from the terminal                          | `leash` CLI in `@leashmarket/cli` — see "Agent surfaces" below                                      |

## Agent surfaces — MCP / CLI / SDK

Leash ships three first-class surfaces for autonomous agents. They all
delegate to the same `LeashHost` contract in `@leashmarket/mcp-core`, so the
behavior is identical across them; only the wire protocol differs.

### `@leashmarket/mcp` — 17-tool STDIO MCP server

Drop into Cursor, Claude Desktop, Cline, Continue, ChatGPT-MCP, or any
host that speaks Model Context Protocol over STDIO. Settlement happens
in-process — `leash_pay_payment_link` actually signs + submits with
the local executive keypair and returns the on-chain receipt.

| Tool name                      | What it does                                                                                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leash_register_agent`         | Two-step provisioning (generate / import executive → fund → mint + delegate + record).                                                                                                                                                                                                       |
| `leash_get_identity`           | Self-introspection: agent mint, treasury PDA, executive pubkey, network.                                                                                                                                                                                                                     |
| `leash_check_treasury_balance` | List SOL + SPL stable balances on the treasury PDA.                                                                                                                                                                                                                                          |
| `leash_create_payment_link`    | Mint a hosted x402/MPP paywall (`/v1/payment-links`). If `upstream_url` is provided, the paid call forwards to that existing endpoint after settlement. For POST endpoints, `expected_request_body` documents the buyer body shape.                                                          |
| `leash_pay_payment_link`       | Probe → policy-check → sign → settle → finalise receipt for an x402 URL.                                                                                                                                                                                                                     |
| `leash_withdraw_treasury`      | Owner-driven SOL or stable withdrawal via `mpl-core::Execute`.                                                                                                                                                                                                                               |
| `leash_set_spend_limit`        | Update the SPL `Approve` delegation (unlimited / amount / revoke).                                                                                                                                                                                                                           |
| `leash_get_spend_limit`        | Read the live delegation + treasury balance for an SPL stable.                                                                                                                                                                                                                               |
| `leash_receipts`               | Paginated receipts feed for the active agent.                                                                                                                                                                                                                                                |
| `leash_get_receipt`            | Look up a single ReceiptV1 by `receipt_hash` (the `/receipt/{hash}` blob the explorer renders).                                                                                                                                                                                              |
| `leash_transaction_history`    | All earn + spend receipts in the last N days (default 7) with USD totals.                                                                                                                                                                                                                    |
| `leash_daily_transactions`     | Per-day buckets for the same window (`{ date, sent_usd, received_usd, net_usd, ... }`).                                                                                                                                                                                                      |
| `leash_discover`               | Public unified search (`/v1/discover`) — merges the Leash marketplace with the Solana Foundation `pay-skills` registry. Each item has a `source: 'leash' \| 'pay-skills'` tag.                                                                                                               |
| `leash_pay_skills_endpoints`   | Expand a `pay-skills` discover item into its individual paid endpoints (`/v1/discover/pay-skills/{fqn}`). Returns `{ method, url, pricing, protocol, supported_usd, probe_status }[]`. The recommended agent flow is `leash_discover → leash_pay_skills_endpoints → leash_pay_payment_link`. |
| `leash_reputation`             | Reputation snapshot for any agent mint (`/v1/agents/:mint/reputation`).                                                                                                                                                                                                                      |

Install:

```bash
npx -y @leashmarket/mcp@latest doctor    # one-shot config check
npx -y @leashmarket/mcp@latest run       # bind to STDIO
```

Provision an agent end-to-end (no human in the loop):

```bash
npx -y @leashmarket/mcp@latest run         # in your MCP host's config
# then ask the agent: "Use leash_register_agent to mint a fresh agent"
# → returns funding_required with a generated executive pubkey
# (LLM walks the user through funding, then re-calls the tool)
```

### `@leashmarket/cli` — `leash` terminal wrapper

Same `LeashHost`, plain-text output. Designed to be the "git/gh/aws"
of the Leash agent economy. Pass `--json` on any command for a
machine-readable `LeashToolResult`.

```text
leash agent create [--name N] [--description T] [--image URL]
                   [--service name=https://endpoint] (repeatable)
                   [--generate | --import --executive <secret>]
leash agent show
leash treasury balance
leash treasury withdraw --to W --amount N --token SOL|USDC|USDG|USDT
leash treasury limit [--token USDC|USDG|USDT]
leash treasury set-limit [--token T] (--unlimited | --revoke | --amount N)
leash discover [-q QUERY] [--max-price N] [--pricing-type T] [--source leash|pay-skills|all] [--limit N]
leash discover endpoints <fqn>             # expand a pay-skills provider into its paid URLs
leash reputation <agent_mint> [--network solana-devnet|solana-mainnet]
leash receipts [--limit N] [--direction outgoing|incoming|both]
leash receipt <receipt_hash>
leash history [--days N] [--direction outgoing|incoming|both] [--limit N]
leash daily   [--days N]
leash pay <link-url>
leash sell create-link --label L --amount N [--method GET|POST] [--upstream-url URL] [--expected-body '{}'] [--protocol x402|mpp]
leash doctor
```

### `@leashmarket/sdk` — typed API client

Anonymous reads, agent-signed writes (X-Leash-Sig), legacy bearer-key
auth for endpoints that haven't migrated yet. Browser/Bun/Deno-friendly.

```ts
import { LeashClient } from '@leashmarket/sdk';
const leash = new LeashClient({ apiKey: process.env.LEASH_API_KEY });

// Single receipt by hash → full ReceiptV1.
const r = await leash.getReceipt(
  'c3c50cb352a2624f783ca6a51bdb7fbcd3b67f04b4a42cd431444db05504181a',
);

// Last 7 days, both directions, with USD totals.
const week = await leash.transactionHistory({ agentMint, days: 7 });
// → { range, count, total_sent_usd, total_received_usd, net_usd, items }

// Same window, bucketed by UTC day.
const daily = await leash.dailyTransactions({ agentMint, days: 7 });
// → { daily: [{ date, sent_usd, received_usd, net_usd, ... }], totals, ... }
```

All three surfaces enforce the same network binding as the API: a
`lsh_test_*` key (devnet) cannot read mainnet receipts, and vice versa.

## Mental model — five primitives

1. **Agent.** A single MPL Core asset (MIP-104 Agent Identity). Owner
   keypair owns the asset; treasury is its Asset Signer PDA.
2. **Treasury.** PDA derived from the asset. Receives SOL + SPL tokens
   without any private key. Withdrawals route through MPL Core `Execute`,
   signed by the **owner** keypair.
3. **Spend allowance.** SPL token `Approve` from the treasury ATA to the
   **executive** keypair (the runtime "agent operator"). The executive
   then signs x402 `TransferChecked`s up to that allowance. Owner
   revokes by re-approving 0.
4. **Policy (`RulesV1`).** Pure JSON — daily budget, per-call cap,
   allowed hosts, triggers. Evaluated by `@leashmarket/core` before any
   payment leaves the wallet.
5. **Receipt (`ReceiptV1`).** Hash-chained JSONL row written for every
   gated call. `prev_receipt_hash` chains, `tx_sig` is the on-chain
   settlement signature, `payment_requirements_hash` proves the payer
   saw the price you asked for.

## The three identities (memorise these — every guide assumes them)

| Role          | Holds                       | Signs                                                                     |
| ------------- | --------------------------- | ------------------------------------------------------------------------- |
| **Owner**     | The MPL Core asset          | Asset transfers, withdrawals via MPL Core Execute, `Approve` (allowance)  |
| **Executive** | The SPL spend delegation    | x402 `TransferChecked` payments (capped by the allowance)                 |
| **Operator**  | An optional runtime keypair | Off-chain operator actions (rotate via on-chain `AppData` if you wire it) |

A facilitator is a **fourth** independent keypair — it pays Solana fees
and submits the buyer's signed transfer. **NEVER** reuse the
buyer/executive key as the facilitator key: x402's
`fee_payer_transferring_funds` check rejects it.

## Universal lifecycle — prepare → sign → submit → track

Every state-changing call (mint, allowance, withdraw, payment-link
create) follows this strict split — the API never touches your private
key:

```
client                     api.leash.market                solana
  │                              │                            │
  │── POST /v1/.../prepare ─────▶│                            │
  │                              │── createPreparedEvent      │
  │◀── { event_id, transaction.base64, echo } ─               │
  │── sign(transaction.base64) (your wallet)                  │
  │── POST /v1/submit ───────────▶│── sendRawTransaction ──▶ │
  │◀── { signature } ─            │                            │
  │── GET /v1/events/{id} (poll until phase=confirmed) ────── │
```

**Always follow every step — especially `POST /v1/submit`.** Submitting
through the API is what:

- Creates the `event_id` row that joins prepare ↔ confirm.
- Broadcasts the transaction on behalf of your agent's watchlist entry.
- Lets the indexer pick up subsequent on-chain activity for that agent
  (receipts, treasury inflows, fee events) and surface them on the
  explorer at `explorer.leash.market`.

**Never broadcast via raw RPC (`sendRawTransaction` / `sendTransaction`
direct).** A transaction sent outside `POST /v1/submit` is invisible to
the API: no event row is written, the agent is not watchlisted, receipts
won't appear in `/v1/events` or on the explorer, and the `/v1/receipts`
feed stays empty for that settlement.

`event_id` is the join key. The agent you prepared for is auto-watchlisted
so any subsequent on-chain activity for it shows up in `/v1/events` and
on the explorer with no extra wiring.

## Network binding via API key prefix

`lsh_test_*` ⇒ `solana-devnet`. `lsh_live_*` ⇒ `solana-mainnet`. There is
no per-request network parameter — the prefix decides. Cross-network reads
are impossible by construction; pick the correct key for the cluster you
want.

## Default workflow when the user says "build a Leash agent"

1. **Decide buyer / seller / merged.** Buyer pays endpoints; seller hosts
   them; merged is one mint that does both. Default to merged if unsure.
2. **Mint the agent** (one tx). SDK: `createAgent` from
   `@leashmarket/registry-utils`. API: `POST /v1/agents/prepare` →
   `POST /v1/submit`.
3. **Provision treasury ATAs** for any stable you'll accept/spend
   (`POST /v1/agents/{mint}/treasury/provision/prepare` → submit). USDC
   on devnet = `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (faucet at
   `https://faucet.circle.com`). USDG = Token-2022.
4. **Approve a spend allowance** from treasury ATA to executive keypair
   if buying. SDK: `prepareSetSpendDelegation`. API:
   `POST /v1/agents/{mint}/delegation/prepare`.
5. **Wire the role:**
   - Buyer → `createBuyer({ agent, signer, sourceTokenAccount, ... })`,
     then `await buyer.fetch(url)`.

- Seller → `createSeller(app, { umi, sellerAgent, routes, ... })` on
  a Hono app, OR `POST /v1/payment-links` for the no-code path. To
  monetize an API that already exists, set `metadata.upstream_url`;
  after settlement Leash forwards the paid request there and returns
  the live upstream response.

6. **Verify on the explorer** — the agent page lists treasury balances,
   spend/earn receipts, and lifecycle events.

## When to use the API vs the SDK

Use the **API** when the caller isn't TypeScript, doesn't want to operate
RPC, or wants receipts + events on the hosted explorer for free.

Use the **SDK** when client-side custody matters, when you're shipping a
library other people install, or when latency / vendor lock-in concerns
rule out a managed service.

## Protocol fee — the 1% Leash leg

Every settlement that flows through a Leash facilitator (devnet or
mainnet) is a **two-leg transaction**: the seller's net `TransferChecked`
**plus** a Leash protocol fee `TransferChecked` for the same mint to a
treasury account owned by the Leash team. This is the only economic
hook in the whole stack — there is no per-call subscription, no
per-agent fee, no markup on facilitator simulation, nothing else.

Numbers and pubkeys you can rely on:

- **Rate.** `100` bps (`1.00%`), ceiling-rounded in atoms so we never
  under-charge by sub-atom truncation.
- **Authorities.** Same wallet on both clusters:
  `3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W`. The fee leg targets
  this owner's ATA for whatever mint the seller quoted in.
- **Wire shape.** Sellers stamp `paymentRequirements.extra['leash.fee']`
  with `{ v: '1', bps, feeAuthority }`. Buyers parse it, derive the
  destination ATA via `getLeashFeeAtaFor` from `@leashmarket/core`, and append
  the fee `TransferChecked` to the same buyer-signed transaction.
- **Quoting.** Sellers _always_ quote net (`amount`). The buyer signs
  `gross = amount + fee`. Receipts carry both: `price.amount` (net),
  `price.fee`, `price.gross`, `price.feeBps`, `price.feeAuthority`.
- **Vanilla x402 still works.** A facilitator that doesn't advertise
  `protocol_fee` on `/health` is treated as a non-Leash facilitator;
  the fee leg is omitted and the buyer signs `amount` flat.

Things to remember when writing code or answering questions:

- **Budget your allowances against `gross`, not `amount`.** If you set a
  `5 USDC` SPL `Approve` you can only consume `~4.95 USDC` of seller-net
  before the fee leg pushes you over. The
  `/v1/agents/{mint}/delegation/prepare` endpoint exposes
  `pad_for_protocol_fee: true` to do this gross-up for you.
- **Fund the agent treasury for the gross too.** Same reasoning — top
  up `5.05 USDC` (atoms `5050000`) to comfortably consume `5 USDC`
  worth of seller-quoted endpoints.
- **`/v1/health` exposes the live fee block** — `bps`, `pct`, and the
  per-network fee authorities. Surface this in any UI before the buyer
  signs so the rate is verifiable, not implied.
- **Explorer.** `protocol.fee.collected` events appear in
  `/v1/events?kind=protocol.fee.collected`, and the explorer's
  "Protocol fees" panel sums them per mint. Receipts show `Net (seller)
/ Protocol fee / Gross (buyer) / Fee authority` on the detail page.
- **Self-hosted facilitators** are bound by the same protocol — see
  `LEASH_FEE_BPS`, `LEASH_FEE_ENFORCE`, and `LEASH_FEE_AUTHORITY_*` in
  `apps/docs/api/run-a-facilitator.mdx`. `enforce` is the production
  default; `warn` is a 24h cutover mode that logs missing fee legs but
  still settles them.

Full spec + math worked examples live in
`apps/docs/api/protocol-fee.mdx`.

## Critical pitfalls (read before writing code)

- **Owner ≠ executive.** Withdrawals need owner; payments need executive.
  Mixing them is the most common bug.
- **Facilitator key must be separate.** See identity table above.
- **Token-2022 vs SPL Token.** USDG is Token-2022. Always pass the right
  program id; don't assume `TOKEN_PROGRAM_ID`.
- **Prefer the `prepare → submit` API path — it is the only path that
  tracks receipts on the explorer.** Don't broadcast via raw RPC unless
  you have a strong reason. Every `prepare*` call auto-watchlists the
  agent; every `POST /v1/submit` writes the event row that drives
  `/v1/events`, the receipt feed, and the explorer. Bypassing submit
  means the transaction is invisible to the API and explorer.
- **`network` is bound to the API key.** Sending `lsh_test_*` against
  mainnet data returns 404 by design. Use the right prefix.
- **Always gross-up budgets / allowances by the 1% protocol fee.** See
  the "Protocol fee" section above. Forgetting this is the #2 source of
  "settlement failed: insufficient_allowance" reports.
- **For LLMs ingesting docs:** prefer the `.md` rendering of every page
  (append `.md` to any URL on `docs.leash.market`), and start from
  `https://docs.leash.market/llms.txt`.

## Drill-down resources

- **`REFERENCE.md`** — Full surface map: every SDK package, every API
  route family, every common operation, common errors and how to fix
  them, key URLs and constants. Read this before answering "where is X?"
  questions.
- **`EXAMPLES.md`** — Copy-pasteable snippets for the five most common
  flows: mint an agent, fund + delegate a treasury, monetise an API,
  build a scriptable buyer, withdraw funds.
- **`INSTALL.md`** — How to install this skill in Cursor, Claude Code,
  Codex, Replit, Windsurf, Continue, or any agent that supports the
  `SKILL.md` convention.

## Authoritative live docs

When in doubt, fetch the canonical docs. They are auto-updated and
LLM-friendly:

- Curated index → <https://docs.leash.market/llms.txt>
- Whole site as one Markdown file → <https://docs.leash.market/llms-full.txt>
- Any page as Markdown → append `.md` to its URL
- OpenAPI 3.1 → <https://api.leash.market/openapi.json>
