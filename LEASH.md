# Leash

**An open rail for agents that spend on the open internet.**

> The smallest surface that turns an MPL Core agent into a constrained, accountable, x402-native economic actor — and that lets every other agent-economy primitive be built as a thin app on top.

Leash is one project shipped in batches. v0.1 is two repos and a website. v1.0 is a full agent-economy stack. Every batch is independently useful; each batch enables the next.

---

## 1. Vision

A user can:

1. Mint an agent (MPL Core asset, MIP-014 registered).
2. Fund its Asset Signer PDA wallet.
3. Write rules (budget, allow/deny hosts, price ceiling, triggers).
4. Let it run — every outbound HTTP call goes through x402, gated by policy, logged as a receipt.
5. Show the world what it did at `leash.app/a/<mint>`.

Anyone else can:

- Index those receipts.
- Build reputation, credit, royalty splits, escrow, subscriptions, data attribution on top — without asking permission.

The bet: **standardize the receipt + the `leash` block in the registration JSON, and the rest of the agent economy assembles itself.**

---

## 2. Why now

| Layer                                | What it gives us                                                                                                                                | Status                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **MIP-014 / `mpl-agent`**            | On-chain agent identity (Core asset + `AgentIdentityV1` PDA), deterministic Asset Signer PDA wallet, ERC-8004 registration doc, lifecycle hooks | Approved by Metaplex DAO Mar 2026, deployed mainnet + devnet at `1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p` |
| **MIP-013** (Trustless Agent Plugin) | Bonding / slashable stake on the agent NFT                                                                                                      | In design                                                                                                     |
| **x402**                             | HTTP-native per-call payment in stablecoins, no accounts, no API keys                                                                           | $24M/mo volume, 75M tx/30d (Apr 2026)                                                                         |
| **PayAI / Faremeter / Corbits**      | Solana facilitator, OSS framework, paid-endpoint gateway                                                                                        | Live                                                                                                          |

Identity, settlement, and bonding all exist. **Nobody has fused them with a policy/receipt layer.** That's the gap Leash fills.

---

## 3. Core concepts (glossary)

- **Agent** — an MPL Core asset registered via `RegisterIdentityV1`. Identity is the asset pubkey.
- **Treasury** — the **Asset Signer PDA** derived from the asset pubkey. Holds funds. Only the asset itself can sign for it through MPL Core's `Execute` instruction.
- **Owner** — the wallet that holds the Core asset NFT. Can pause, update rules, withdraw.
- **Executive** — a delegated key (via Agent Tools program `DelegateExecutionV1`) that the runner uses to sign x402 payments without exposing the owner's key.
- **Rules** — a typed JSON document at `rulesUri`, evaluated by `Policy.evaluate`.
- **Receipt** — an immutable record of one decision (allow + paid, or deny + reason), hash-chained per agent.
- **Receipts feed** — public JSONL stream at `receiptsFeed`.
- **`leash` block** — an additive object in the ERC-8004 registration JSON that points to rules + receipts feed + version. The standardization play.
- **Trustline** — (v0.4+) credit extended to an agent against bond + receipt history.

---

## 4. Architecture

```
                          MIP-014 (mpl-agent)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
       Core Asset (NFT)                          Asset Signer PDA
       = identity                                = treasury
            │                                           │
            │ AppData URI ──► ERC-8004 JSON            │
            │                  + leash block            │
            │                                           │
            └────────► Rules (rulesUri) ◄───────────────┘
                              │
                              ▼
   ┌───────────────────────────────────────────────────────┐
   │                    leash-runner                       │
   │                                                       │
   │   Trigger ──► Handler ──► fetch(url, opts)           │
   │                              │                        │
   │                              ▼                        │
   │                    Policy.evaluate(req, rules, state) │
   │                              │                        │
   │            ┌─── deny(reason) ┴── allow ───┐          │
   │            ▼                                ▼          │
   │       log receipt              x402Client.pay+retry   │
   │                                          │             │
   │                                          ▼             │
   │                          Receipt {req, price, txSig,  │
   │                          policy_v, prev_hash, status} │
   │                                          │             │
   │                                          ▼             │
   │                              hash-chain + JSONL        │
   │                                          │             │
   │                              periodic Merkle root      │
   │                              ──► posted on Solana      │
   └───────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
       /a/<mint>/receipts.jsonl   tamper-evident anchor
       (public, indexable)        (one tx per N receipts)
                              │
                              ▼
       Anyone builds: dashboards · alerts · taxes ·
       reputation · credit · royalty splits · escrow ·
       streaming subs · data attribution
```

---

## 5. The 10 primitives, mapped to Leash modules

Every primitive from the original brainstorm has a home in Leash. Some ship in v0.1; some are downstream apps that the core enables.

| #   | Primitive                                  | Where it lives in Leash                                                                                  | Batch                              |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Agent-bound x402 wallet adapter            | `leash-core` → `Agent`, `Wallet`, `x402Client`                                                           | **v0.1**                           |
| 2   | Proof-of-Call attestation                  | `leash-runner` receipt log + `leash-anchor` Merkle anchoring                                             | **v0.1** (log) / **v0.2** (anchor) |
| —   | Policy / spending governance               | `leash-core` → `Policy.evaluate`, `Rules` schema                                                         | **v0.1**                           |
| 5   | Skill marketplace (A2A/MCP + x402 pricing) | `leash-registry-utils` extends ERC-8004 with `pricing` + `leash` block; `leash-mcp` exposes it           | **v0.2**                           |
| 3   | Reputation-gated x402 endpoints            | `leash-gate` Faremeter middleware: requires registration + bond + reputation                             | **v0.3**                           |
| 10  | Reputation oracle                          | `leash-rep` aggregator service — eats receipts feeds, exposes `getReputation(mint)` via x402             | **v0.3**                           |
| 9   | Data agent provenance                      | Rule type `dataAgent` + `usage` receipt sub-type; reference dataset agent in `leash-sellers`             | **v0.3**                           |
| 6   | Per-call royalty splits                    | Policy rule type `split: [{recipient, bps}]` — settled at receipt time via CPI                           | **v0.4**                           |
| 7   | Streamed x402 subscriptions                | Rule type `subscription: {endpoint, ratePerSec, cap}` + `leash-stream` channel manager                   | **v0.4**                           |
| 8   | Multi-hop escrow & call routing            | Policy rule type `escrow: {until: attestation}`; `leash-escrow` program holds funds against Asset Signer | **v0.5**                           |
| 4   | Agent credit lines (BNPL)                  | `leash-trust` underwriter — opens USDC line against MIP-013 bond + receipt history                       | **v1.0**                           |

The "missed" primitive — **Policy** — is the keystone. Without it, none of the others compose safely.

---

## 6. Batched delivery roadmap

Each batch ships independently, has a clear demo, and earns the right to the next batch.

### Batch v0.1 — "Mint, leash, spend, prove" (2 weeks)

**Goal:** anyone can mint an agent, give it $5, set a rule, watch it spend on a public x402 endpoint, share the receipts URL.

Repos:

- `leash-core` — TS SDK. `Agent`, `Wallet`, `x402Client`, `Policy.evaluate`, `Receipt` type, Zod `Rules` schema.
- `leash-runner` — Node service. SQLite, cron + webhook triggers, append-only JSONL log, kill-switch endpoint.
- `leash-registry-utils` — TS. `mintAndRegister`, `leash` block JSON Schema, validators.
- `leash-app` — Next.js. `/new`, `/a/[mint]`, 5 seed templates, OG image generator.
- `leash-sellers` — 5 reference x402 endpoints (weather, headlines, ping, joke, summarize). **Critical for non-vapor demos.**

Out of scope for v0.1: LLM, token, custodial keys, Merkle anchor, MCP, splits, escrow, credit, reputation, streaming subs.

Acceptance criteria:

- `docker compose up` runs the full stack.
- Mint → register → fund → first paid call → public receipts URL in under 5 minutes.
- Daily budget + per-call ceiling + allow/deny host + onchain pause all enforced and tested.
- Receipt schema v0.1 frozen and published.

### Batch v0.2 — "Standards & discoverability" (2 weeks)

**Goal:** make Leash agents findable and tamper-evident; turn the registration extension into a real standard.

Repos added / extended:

- `leash-anchor` — cron service that hash-chains receipts and posts a Merkle root on Solana every N minutes. Verifier library included.
- `leash-mcp` — MCP server exposing `run_agent`, `fetch_receipts`, `fork_template`, `mint_from_template` as x402-gated tools. Cursor / Claude Desktop integration.
- `leash-registry-utils` — adds optional `pricing` block to the registration JSON for A2A/MCP services. Coordinated with Metaplex via MIP discussion.
- `leash-templates` — separate CC0 repo, 25+ JSON rule packs.
- `leash-app` — `/t` templates gallery, leaderboards (with "useful call" definition), simulate mode.

Acceptance criteria:

- A third-party can verify receipt integrity from the Merkle root + JSONL feed.
- Cursor can mint and run a Leash agent end-to-end via the MCP server.
- `leash` block + `pricing` block schemas v0.2 frozen, PR opened against `metaplex-foundation/mip` for community review.

### Batch v0.3 — "Reputation & gates" (3 weeks)

**Goal:** receipts become reputation; reputation gates endpoints; sybil-resistant paid APIs become possible.

Repos added:

- `leash-rep` — aggregator service. Subscribes to receipts feeds, computes reputation (uptime under budget, deny rate, host diversity, age, bond size). Exposes `GET /reputation/<mint>` via x402.
- `leash-gate` — Faremeter middleware. Requires `(payment AND registered AND bond≥X AND reputation≥Y)`. Drop-in for any x402 seller.
- `leash-data` — opinionated wrapper for **data agents**: dataset registered as a Core asset, every read produces a `usage` receipt, royalty rule routes payment to the dataset owner.

Acceptance criteria:

- A reputation score for any Leash agent is queryable in one HTTP call.
- A gated x402 seller rejects un-bonded or low-rep callers but accepts qualified ones, end-to-end demo.
- A data agent in `leash-sellers` shows full provenance trail.

### Batch v0.4 — "Splits, streams, multi-party economics" (3 weeks)

**Goal:** payments stop being one-shot and one-recipient; agents can subscribe to feeds and waterfall payment to multiple parties.

Repos added:

- `leash-splits` — policy rule type + settlement helper. At receipt time, a single x402 payment is split via a small on-chain helper program among `[{recipient, bps}]`. Recipients can be Asset Signer PDAs, regular wallets, or other agents.
- `leash-stream` — channel manager. Opens a continuous x402 channel from an Asset Signer to an endpoint at `ratePerSec` with a `cap`, cancellable by the owner via tx. Receipts emitted per drain.

Rule schema additions:

```json
{
  "splits": [{ "recipient": "<pubkey>", "bps": 500 }],
  "subscriptions": [{ "endpoint": "https://feed.example/x402", "ratePerSec": 0.0001, "cap": 5 }]
}
```

### Batch v0.5 — "Escrow & multi-hop" (3 weeks)

**Goal:** non-trivial agent workflows where A pays B which calls C, with attestation and dispute.

Repos added:

- `leash-escrow` — Solana program. Holds x402 payment against an Asset Signer until an attestation receipt arrives, or slashes the MIP-013 bond on dispute.
- `leash-runner` — multi-hop awareness: outbound calls to other Leash agents are tagged in receipts so the call graph is reconstructable.

### Batch v1.0 — "Credit" (4 weeks)

**Goal:** the commercial product. Underwrite agents.

Repos added:

- `leash-trust` — underwriter service + thin Solana program. Reads `(MIP-013 bond, receipts history, deny rate, host diversity, age)` and opens a USDC credit line to the Asset Signer. Repaid from the agent's revenue stream (incoming x402 payments). Defaults slash the bond.
- `leash-app` — `/a/[mint]/credit` page: shows credit line, utilization, repayment history.

This is the first batch with a clear monetization model (interest spread). Everything before it was infrastructure and standards.

### v1.x and beyond (not promised, just placeholders)

- Cross-chain receipts (EVM x402 mirror).
- Agent-to-agent procurement (RFQ over A2A + x402 + escrow).
- Insurance pools against runaway agents.
- DAO-owned agents with multi-sig owners.

---

## 7. Repo map (final state)

| Repo                   | License                         | Purpose                                                 | First batch |
| ---------------------- | ------------------------------- | ------------------------------------------------------- | ----------- |
| `leash-core`           | MIT                             | SDK: Agent, Wallet, x402Client, Policy, Receipt         | v0.1        |
| `leash-runner`         | Apache-2.0                      | Execution loop, receipt log, kill switch                | v0.1        |
| `leash-registry-utils` | MIT                             | mpl-agent helpers, `leash` + `pricing` block schemas    | v0.1        |
| `leash-app`            | AGPL-3.0                        | Web surface (mint, agent page, templates, leaderboards) | v0.1        |
| `leash-sellers`        | MIT                             | Reference x402 endpoints for demos                      | v0.1        |
| `leash-anchor`         | Apache-2.0                      | Merkle root anchoring service + verifier                | v0.2        |
| `leash-mcp`            | MIT                             | MCP server, x402-gated                                  | v0.2        |
| `leash-templates`      | CC0                             | JSON rule packs (data only)                             | v0.2        |
| `leash-rep`            | Apache-2.0                      | Reputation aggregator                                   | v0.3        |
| `leash-gate`           | MIT                             | Faremeter middleware (registration + bond + rep)        | v0.3        |
| `leash-data`           | MIT                             | Data-agent wrapper + provenance receipts                | v0.3        |
| `leash-splits`         | MIT + Apache-2.0                | Royalty split policy + on-chain helper                  | v0.4        |
| `leash-stream`         | Apache-2.0                      | Streaming x402 channel manager                          | v0.4        |
| `leash-escrow`         | Apache-2.0                      | Escrow program + runner integration                     | v0.5        |
| `leash-trust`          | Apache-2.0 + commercial service | Credit underwriting                                     | v1.0        |

License philosophy: SDKs and schemas MIT for maximum adoption; services Apache-2.0 with patent grant; web app AGPL to discourage closed-source SaaS rebranding; templates CC0 for zero-friction PRs.

---

## 7a. Language and runtime choices

**Rule of thumb:** TypeScript first for everything off-chain in v0.1. Rust where it actually matters — on-chain programs and the anchor service. Wire formats are language-agnostic so multiple implementations can coexist.

| Repo                                                                              | Language                                                   | Reasoning                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leash-core`                                                                      | TypeScript                                                 | `@metaplex-foundation/mpl-agent-registry`, Faremeter, PayAI, Privy, CDP — the entire x402 + mpl-agent stack is TS-first. Rust here would require re-implementing five SDKs and shrinking the contributor pool by ~10x. |
| `leash-runner`                                                                    | TypeScript (v0.1). Rust port (`leash-runner-rs`) in v0.3+. | Node handles a few thousand agents per box. Bottleneck is RPC + x402 settlement latency + SQLite — none fixed by Rust. Ship TS, shard horizontally, port to Rust only when an operator hits the wall.                  |
| `leash-registry-utils`                                                            | TypeScript                                                 | Thin wrapper on an existing TS SDK.                                                                                                                                                                                    |
| `leash-app`                                                                       | TypeScript (Next.js)                                       | Obvious.                                                                                                                                                                                                               |
| `leash-sellers`                                                                   | TypeScript (Hono)                                          | Reference apps meant to be forked. Low contribution bar matters more than performance.                                                                                                                                 |
| `leash-anchor` (v0.2)                                                             | **Rust**                                                   | Long-running daemon, continuous tx signing, Merkle hashing in a tight loop. Memory + latency matter. Onchain commitments deserve a hardened binary.                                                                    |
| `leash-mcp`                                                                       | TypeScript                                                 | MCP server SDK is TS-native.                                                                                                                                                                                           |
| `leash-templates`                                                                 | (data only)                                                | JSON, no language.                                                                                                                                                                                                     |
| `leash-rep`                                                                       | TypeScript first; Rust if hot                              | Aggregator service. Fine in TS until it isn't.                                                                                                                                                                         |
| `leash-gate`                                                                      | TypeScript                                                 | Faremeter middleware.                                                                                                                                                                                                  |
| `leash-data`                                                                      | TypeScript                                                 | Wrapper.                                                                                                                                                                                                               |
| `leash-splits`, `leash-stream`, `leash-escrow`, `leash-trust` (on-chain programs) | **Rust + Anchor**                                          | Solana programs. No alternative.                                                                                                                                                                                       |

### Why not Rust everywhere

The "Rust = scale" instinct is wrong here. The dominant runtime costs of a Leash node are:

1. Solana RPC round-trip latency.
2. x402 facilitator round-trips.
3. Wallet signing latency.
4. Receipt write throughput (SQLite ≈ 10k writes/sec; Postgres further).

None of these is a CPU-bound Node bottleneck. Rust matters when **per-agent memory footprint** dominates (operators running 10k+ agents per box — a v0.3+ problem) or in **tight cryptographic loops** (Merkle builds, signature aggregation — that's `leash-anchor`).

### The scaling trick: language-agnostic wire formats

Receipts, rules, `leash` block, and kill-switch protocol are all JSON. That means:

- Long-tail operators run the TypeScript runner.
- Hosted operators at scale run the Rust runner.
- Any third party can ship a runner in Go, Python, or Elixir as long as it passes the conformance suite (introduced in v0.2).

This is how Lightning scaled with both Go and Rust implementations side by side. Same play.

### Concrete language milestones

- **v0.1**: 100% TypeScript off-chain. Ship in two weeks. Freeze schemas. Get usage.
- **v0.2**: Introduce Rust for `leash-anchor` only. Publish receipt + rules conformance test suite that any implementation can run.
- **v0.3+**: Rust port of `leash-runner` as `leash-runner-rs`, parallel implementation, same wire formats.
- **v0.4+**: All on-chain programs in Anchor (Rust). Default.

---

## 7b. Reference sellers (`leash-sellers`)

**Why this ships in v0.1, not v0.2:** without sellers, every demo is "watch the agent successfully do nothing." The leash metaphor only lands when there's a real internet to spend on. The wider x402 ecosystem has thousands of endpoints but few are the right shape for an autonomous agent demo. Ship our own.

Five seed sellers, all in one repo, one `docker compose` service:

| Endpoint            | Method       | Price (USDC) | Purpose                                                        |
| ------------------- | ------------ | ------------ | -------------------------------------------------------------- |
| `/weather?zip=`     | GET          | 0.001        | Boring, deterministic, easy to verify.                         |
| `/headlines?topic=` | GET          | 0.005        | Time-varying — good for trigger demos.                         |
| `/summarize`        | POST `{url}` | 0.01         | Heavier; demonstrates body hashing in receipts.                |
| `/ping`             | GET          | 0.0001       | Smoke test for x402 itself. Cheap enough for tight test loops. |
| `/joke`             | GET          | 0.001        | Shareable demo. Memes ship the project.                        |

`leash-sellers` doubles as the **reference implementation for new x402 sellers**. A 200-line README ("how to add your own seller") makes it the easiest on-ramp into the x402 ecosystem, which grows the long tail of useful endpoints — good for everyone including Leash.

---

## 8. Standards (the things that must not change casually)

These are the artifacts that other people will index against. Version every one of them and freeze ASAP.

### 8.1 The `leash` block (extends ERC-8004 registration JSON)

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "...",
  "image": "...",
  "services": [...],
  "registrations": [...],

  "leash": {
    "v": "0.1",
    "rulesUri": "ar://<tx>",
    "receiptsFeed": "https://leash.app/a/<mint>/receipts.jsonl",
    "anchor": {
      "program": "<leash-anchor program id>",
      "merkleAccount": "<pubkey>"
    },
    "killSwitch": {
      "onchain": "<pubkey>",
      "endpoint": "https://leash.app/a/<mint>/pause"
    }
  }
}
```

Coordinate with Metaplex via a MIP discussion before v0.1 ships. Do not unilaterally fork the schema.

### 8.2 Receipt schema v0.1

```json
{
  "v": "0.1",
  "agent": "<mint pubkey>",
  "nonce": 12345,
  "ts": "2026-04-20T18:36:00Z",
  "policy_v": "0.1",
  "request": {
    "method": "GET",
    "url": "https://api.example.com/weather?zip=10001",
    "body_hash": null,
    "headers_hash": "sha256:..."
  },
  "decision": "allow" | "deny",
  "reason": null | "dailyBudgetExceeded" | "denyHost" | "priceCeiling" | ...,
  "price": { "amount": "0.001", "currency": "USDC", "network": "solana" },
  "facilitator": "payai" | "corbits" | "self",
  "tx_sig": "<sig>" | null,
  "response": { "status": 200, "body_hash": "sha256:..." } | null,
  "prev_receipt_hash": "sha256:...",
  "receipt_hash": "sha256:..."
}
```

Required fields are non-negotiable across versions. New fields are additive only.

### 8.3 Rules schema v0.1 (Zod source of truth in `leash-core`)

```ts
const Rules = z.object({
  v: z.literal('0.1'),
  budget: z.object({
    daily: z.string(),
    perCall: z.string(),
    currency: z.literal('USDC'),
  }),
  hosts: z.object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  }),
  priceCeiling: z.string().optional(),
  triggers: z.array(Trigger),
  stopOn: z.array(StopCondition).optional(),
});
```

Future batches add `splits`, `subscriptions`, `escrow`, `dataAgent`, `gate` — always additive, always behind `v` bump.

### 8.4 Pricing block (v0.2)

Extends each entry in `services[]`:

```json
{
  "name": "MCP",
  "endpoint": "...",
  "version": "2025-06-18",
  "pricing": {
    "scheme": "x402",
    "perCall": { "amount": "0.005", "currency": "USDC" },
    "tools": {
      "summarize": { "amount": "0.01" },
      "search": { "amount": "0.001" }
    }
  }
}
```

---

## 9. Non-goals (explicit, repeated, in the README)

Leash will not ship in v0.1 — and may never ship — any of:

- An LLM, model gateway, or chat UI.
- A Leash token. Funds are USDC (and whatever x402 supports).
- Custodial key storage beyond the Asset Signer PDA + optional delegated executive.
- Payment rails other than x402.
- A leaderboard that rewards raw call count.
- Replay-as-time-travel (replay is a re-run with a new settlement, clearly labeled).
- Anything that requires a new on-chain program in v0.1. (First on-chain program is `leash-anchor` in v0.2; programs after that are tightly scoped.)

---

## 10. Risks and mitigations

| Risk                                                      | Mitigation                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| x402 ecosystem too thin — no useful endpoints to spend on | Ship `leash-sellers` in v0.1 with 5 reference endpoints. Recruit 10 more before v0.2.                                                                                          |
| Custody confusion — "is Leash holding my keys?"           | UI says "Asset Signer PDA holds funds. Owner controls. Runner is non-custodial." on every page that touches money. Audit copy weekly.                                          |
| Runaway spend / abuse                                     | Per-call ceiling + daily budget + global circuit breaker (env flag) + onchain kill-switch all in v0.1. Deny-by-default for unrecognized hosts is a config option from day one. |
| "Agent" fatigue                                           | Lean into the leash / receipt metaphor everywhere. Novelty is constrained spending with an audit trail, not intelligence.                                                      |
| Schema fragmentation with Metaplex                        | Coordinate `leash` block via MIP discussion before v0.1 ships. Be willing to rename the block if Metaplex prefers a neutral name.                                              |
| Receipt format drift                                      | Freeze v0.1 before launch. Additive-only changes. Version field mandatory.                                                                                                     |
| Reputation gaming (v0.3+)                                 | Define "useful call" precisely (2xx response, non-deny-listed host, price floor). Weight recent calls more. Diversity bonus for host variety. Publish the formula.             |
| Credit underwriting losses (v1.0)                         | Start undercollateralized only against bonded agents (MIP-013). Hard cap per agent. Public default rate.                                                                       |
| Legal exposure on credit (v1.0)                           | Treat as commercial product, separate entity, jurisdiction-clear. Open-source the protocol; the underwriter service is operated.                                               |
| Dependency on Metaplex Foundation                         | mpl-agent is open-source; could fork if needed but unlikely. Keep `leash-core` thin enough to swap registry.                                                                   |
| Dependency on PayAI / Coinbase                            | x402 is an open standard; multiple facilitators already exist (PayAI, Corbits). Treat facilitator as pluggable.                                                                |

---

## 11. Open questions (decide before v0.1 ships)

1. **Block name.** `leash` vs. something neutral like `agentRules` or `policy`. Recommend: ship as `leash` for branding, accept rename if Metaplex standardizes.
2. **Receipt storage.** SQLite + JSONL file is v0.1. Postgres + S3 is v0.2. Should we offer Arweave/IPFS pinning by v0.2 as well? Recommend: yes, optional flag.
3. **Anchor cadence.** Per-call onchain anchor is too expensive. Per-hour Merkle root is cheap and probably enough. Recommend: configurable, default 1 hour.
4. **Executive vs. owner-signs.** v0.1 should support both: hot executive for autonomous mode, owner-signs for paranoid mode. Default to executive with a "rotate now" button.
5. **Multi-tenant runner.** v0.1 is single-tenant per docker compose. Multi-tenant in v0.2? Recommend: keep single-tenant only until after v0.2 standards are frozen — otherwise the SaaS pull derails the standards work.
6. **Reputation formula.** Publish v0.1 of the formula in `leash-rep` as a markdown spec, not buried in code. Solicit critique loudly.
7. **Credit pricing.** What's the v1.0 interest rate model? Recommend: simple utilization curve to start, copy from Aave v3 with simpler parameters.

---

## 12. The one-paragraph pitch

> Leash is open-source infrastructure for putting AI agents on the open internet with a wallet, a leash, and a public receipt. Every agent has a verifiable on-chain identity (Metaplex MIP-014), pays for what it uses via x402, and is gated by a typed policy you control. Every call is logged as a tamper-evident receipt anyone can index. On top of those receipts, we ship — and others ship — reputation, royalty splits, streaming subscriptions, escrow, and credit. The bet: standardize the smallest layer (identity + policy + receipt), and the rest of the agent economy assembles itself.

---

_Last updated: 2026-04-20. Version: 0.1-draft._
