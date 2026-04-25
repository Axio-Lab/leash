---
name: leash
description: >-
  Build, monetise, and operate Solana agents that pay each other in real
  SPL stables (USDC / USDT / USDG) via the x402 protocol. Use whenever the
  user mentions Leash, leash.market, agent treasuries, x402, agent-to-agent
  payments, agent payment links, agent paywalls, MPL Core agents on Solana,
  monetise an API per call on Solana, or wants to build a buyer / seller /
  merged agent. Covers the @leash/* SDK, the api.leash.market HTTPS surface,
  the prepare → sign → submit lifecycle, hosted payment links at /x/{id},
  the explorer at explorer.leash.market, the local facilitator, and the
  fund / withdraw flows on the agent treasury PDA.
---

# Leash — Agent payments on Solana via x402

Leash gives every agent a wallet (an MPL Core asset whose **Asset Signer
PDA** is the treasury), a capped spend allowance the owner controls (an
SPL token delegation), real x402 settlement in USDC / USDT / USDG, and a
hash-chained `ReceiptV1` audit log. Buyer and seller are **capabilities
on the same identity** — one mint, two roles.

## Pick your surface

| You want to…                                             | Reach for                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Drive Leash from Python / Go / Rust / curl               | The HTTPS API at `api.leash.market` — see `REFERENCE.md`            |
| Ship a TS app with no remote dependency                  | The `@leash/*` SDK packages — see `EXAMPLES.md`                     |
| Charge per call on a SaaS endpoint you already host      | Hosted **payment links** (`POST /v1/payment-links`)                 |
| Mount real x402 middleware on your own Hono app          | `@leash/seller-kit` `createSeller`                                  |
| Script an agent that pays an x402 endpoint               | `@leash/buyer-kit` `createBuyer`                                    |
| Mint a brand-new agent (asset + AgentIdentity) in one tx | `@leash/registry-utils` `createAgent`, or `POST /v1/agents/prepare` |
| Inspect agents / receipts / events with a UI             | `https://explorer.leash.market`                                     |
| Settle locally without depending on hosted infra         | `@leash/facilitator` (devnet) — see `REFERENCE.md`                  |

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
   allowed hosts, triggers. Evaluated by `@leash/core` before any
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
   `@leash/registry-utils`. API: `POST /v1/agents/prepare` →
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
     a Hono app, OR `POST /v1/payment-links` for the no-code path.
6. **Verify on the explorer** — the agent page lists treasury balances,
   spend/earn receipts, and lifecycle events.

## When to use the API vs the SDK

Use the **API** when the caller isn't TypeScript, doesn't want to operate
RPC, or wants receipts + events on the hosted explorer for free.

Use the **SDK** when client-side custody matters, when you're shipping a
library other people install, or when latency / vendor lock-in concerns
rule out a managed service.

## Critical pitfalls (read before writing code)

- **Owner ≠ executive.** Withdrawals need owner; payments need executive.
  Mixing them is the most common bug.
- **Facilitator key must be separate.** See identity table above.
- **Token-2022 vs SPL Token.** USDG is Token-2022. Always pass the right
  program id; don't assume `TOKEN_PROGRAM_ID`.
- **Prefer the `prepare → submit` API path.** Don't try to roll your own
  Solana RPC unless you have a reason. The API auto-watchlists the agent
  for you on every prepare call.
- **`network` is bound to the API key.** Sending `lsh_test_*` against
  mainnet data returns 404 by design. Use the right prefix.
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
