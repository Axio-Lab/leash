# Leash for Agents — Full Product Spec

_Companion to `notes/yc-make-something-agents-want.md`. This is the
complete implementation blueprint for turning Leash into the
software product every AI agent needs: MCP server + CLI + SDK +
public OpenAPI + sandbox + cross-interface portability. It also
includes the exact 60-second demo we record for YC._

---

## What we're shipping (one paragraph)

Leash becomes the **operating system for agent-to-agent commerce on
Solana**, exposed through five complementary surfaces — an MCP
server (`@leash/mcp`), a CLI (`leash`), an SDK (`@leash/sdk`), a
public versioned OpenAPI, and a frictionless devnet sandbox — all
backed by the same on-chain primitives we already shipped (MPL Core
agent identity, treasury PDA, x402 paywalls, SPL spend delegation,
receipt graph). Any AI agent in any host installs Leash with one
config block and instantly gets autonomous identity, a self-custodial
treasury, the ability to pay any x402 URL, the ability to receive
payments, the ability to discover other agents' tools, and the
ability to verify on-chain reputation — without a human in the loop
after first-run funding.

---

## The five surfaces

The product as agents see it:

| Surface               | Who uses it                                                            | Install                                       | Killer demo                               |
| --------------------- | ---------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| **`@leash/mcp`**      | Agents inside Cursor / Claude Desktop / Cline / Continue / ChatGPT-MCP | one mcp.json block                            | "Pay this URL from Cursor"                |
| **`leash` CLI**       | Headless agents on servers; humans debugging                           | `npm i -g @leash/cli` or `brew install leash` | One-line scripted payments                |
| **`@leash/sdk` (TS)** | Anyone embedding Leash in their own product                            | `npm install @leash/sdk`                      | 30-second monetization of an existing API |
| **Public OpenAPI**    | Anyone wanting to generate their own client                            | `https://api.leash.market/openapi.json`       | Generates `@leash/sdk` itself             |
| **Sandbox**           | Curious agents kicking the tires                                       | `POST /v1/sandbox/agent`                      | Funded devnet agent in <2s                |

All five drive the **same on-chain primitives**. We are not
maintaining five products — we're maintaining one core platform with
five front doors.

---

## Architecture at a glance

```
                          ┌──────────────────────────────────┐
                          │    Solana mainnet (or devnet)    │
                          │  ─ Agent NFT (MPL Core asset)    │
                          │  ─ Treasury PDA + ATAs           │
                          │  ─ x402 receipts                 │
                          │  ─ SPL Approve (spend delegation)│
                          └──────────────┬───────────────────┘
                                         │ Solana RPC
        ┌────────────────────────────────┴───────────────────────────────┐
        │                                                                │
┌───────┴────────┐                                              ┌────────┴───────┐
│   @leash/mcp   │                                              │   leash CLI    │
│ (STDIO server) │                                              │ (Node binary)  │
└───────┬────────┘                                              └────────┬───────┘
        │                                                                │
        │  ┌──────────────────────────────────────────────────┐          │
        │  │              api.leash.market (REST)             │          │
        │  │ ─ /v1/agents/self-register   /v1/discover        │          │
        │  │ ─ /v1/payment-links          /v1/agents/:m/rep   │          │
        │  │ ─ /v1/receipts               /v1/sandbox/agent   │          │
        │  │ ─ /v1/agents/:m/webhooks     /openapi.json       │          │
        │  └──────────────────────────────────────────────────┘          │
        │                              ▲                                 │
        │                              │                                 │
        ▼                              │                                 ▼
┌────────────────┐         ┌───────────┴───────────┐         ┌────────────────────┐
│  @leash/sdk    │◀────────│  Auto-generated from  │────────▶│ agents.leash.market│
│  (npm)         │         │  the same OpenAPI doc │         │  (web chat)        │
└────────────────┘         └───────────────────────┘         └────────────────────┘

         All five surfaces speak Solana directly for signing and
         api.leash.market for off-chain operations (discovery,
         reputation, webhooks). All five are self-custodial — Leash
         never holds private keys.
```

---

## Auth & identity model

Three identities to keep straight:

1. **The user (human)** — the person installing the MCP / CLI /
   logging in to the chat. Holds nothing directly; their Privy
   account or local keypair is the "owner" of an on-chain agent.
2. **The Leash agent (on-chain)** — an MPL Core asset on Solana.
   Owns the treasury PDA. Has metadata (EIP-8004 RegistrationV1).
3. **The executive (keypair)** — the SPL delegate authorised to
   spend from the treasury, up to the per-day cap. Can be either:
   - User's Privy embedded wallet (chat-first users)
   - A local ed25519 keypair stored at `~/.config/leash/agent.json`
     (MCP/CLI-first users)

```
~/.config/leash/agent.json  (chmod 600)
{
  "version": 1,
  "agent_mint": "AgntXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "executive_keypair": "5Jz...",  // base58
  "network": "solana-mainnet",
  "created_at": "2026-04-30T..."
}
```

Same posture as `gcloud`, `gh`, `aws` config dirs.

### How the API knows which agent is calling

Two paths, depending on what's being called:

- **On-chain ops** (pay, withdraw, balance check) — sign locally
  with the executive keypair (or Privy wallet), submit to Solana
  RPC. **No Leash API auth needed**. Pure self-custody.
- **Off-chain ops** (discover, reputation, receipts, webhooks) —
  HTTP request to api.leash.market with headers
  `X-Leash-Agent: <mint>` + `X-Leash-Sig: <ed25519 sig of
method+path+timestamp+body>`. Server verifies the signature
  against the agent's on-chain executive pubkey. **No DB-side API
  keys. Auth surface == wallet surface.**

This is a meaningful differentiator. Most agent platforms hand out
`sk_live_*` secrets that can leak. We use the agent's own keypair
as the identity. Rotate the delegate on-chain and the auth rotates
with it — atomically.

---

## Cross-interface agent portability

The killer feature most "agent platform" startups will skip. **Same
on-chain agent must be drivable from MCP/CLI _and_ the web chat.**

We use the MPL Core asset's two fields as a clean separation:

| Field                    | Who                       | Why                                                      |
| ------------------------ | ------------------------- | -------------------------------------------------------- |
| `owner`                  | User's Privy wallet       | Recoverable via 2FA + email. Lost-laptop recovery story. |
| `delegate` (SPL Approve) | MCP/CLI executive keypair | Day-to-day signing without a popup.                      |

### MCP → Chat ("I started in Cursor, now I want the web UI too")

```
> leash export-to-chat --privy-address <YOUR_PRIVY_WALLET>

✓ Submitting MPL Core transfer tx... (signed by current owner)
✓ Owner is now <YOUR_PRIVY_WALLET>
✓ SPL delegate remains <MCP_KEYPAIR> (Cursor keeps working)
✓ Open https://agents.leash.market — agent appears in the sidebar.
```

A single `transfer` instruction signed by the local keypair (current
owner) reassigns the asset to the Privy wallet. The local executive
keypair stays as SPL delegate, so Cursor / Claude Desktop / etc.
keep working without missing a beat. Next time the user signs into
agents.leash.market with that Privy wallet, the agent appears in
the sidebar — no import button required.

### Chat → MCP ("I started in the web UI, now I want it in Cursor too")

```
[in agents.leash.market → Profile → Agent → ⋯]
"Export to Cursor / CLI"

→ Browser asks for Privy signature on an SPL `Approve` instruction
  rotating the delegate to a fresh keypair.
→ Browser one-shot-downloads `agent.json` (the new keypair).
→ Inline instructions: "Save to ~/.config/leash/agent.json then
   add Leash to your mcp.json. The keypair shows once."
```

Privy stays as owner (recoverable identity). The new keypair
becomes the operational executive for MCP/CLI use.

### Why this matters

- **Recovery**: lost MCP machine? Sign into the web chat with
  Privy (still owner), click "Rotate executive", get a new
  keypair. Same agent, new device, ~10s.
- **Multi-device**: `leash agent rotate-executive` works from
  any signed-in surface. Same agent everywhere.
- **Audit**: every rotation is an on-chain `Approve` instruction
  visible on the explorer. No off-chain ACLs to argue about.
- **No fragmentation**: MCP-first users aren't a separate cohort
  to win back later. They're already in the funnel.

---

## Surface 1 — `@leash/mcp` (the wedge)

A STDIO MCP server published to npm. One config block in
Cursor / Claude Desktop / Cline / Continue / ChatGPT-with-MCP.

### The nine tools

```ts
// 1. First-run provisioning. Only call once per agent.
leash_register_agent(opts: {
  name?: string;
  network?: "solana-mainnet" | "solana-devnet";  // default: devnet
}) => {
  agent_mint: string;
  treasury_address: string;
  executive_pubkey: string;
  funded_with: { sol: number; usdc: number };
  explorer_url: string;
};

// 2. Self-introspection.
leash_get_identity() => {
  agent_mint: string;
  treasury_address: string;
  executive_pubkey: string;
  name: string | null;
  network: "solana-mainnet" | "solana-devnet";
  registered_at: string;
};

// 3. Treasury balances + spend caps.
leash_check_balances() => {
  sol: number; usdc: number; usdt: number; usdg: number;
  spend_caps: { per_action: number; per_day: number };
};

// 4. Host an inbound paywall.
leash_create_payment_link(opts: {
  amount_usdc: number;
  description: string;
  expires_in_seconds?: number;  // default 3600
}) => {
  url: string;             // https://api.leash.market/x/abc123
  qr_code_data_uri: string;
  expires_at: string;
};

// 5. Pay any x402-priced URL. The killer tool.
leash_pay(opts: {
  url: string;
  max_price_usdc?: number;  // safety ceiling, default 1.0
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}) => {
  status: number;
  response_body: string;
  paid_amount_usdc: number;
  tx_signature: string;
  receipt_url: string;
  explorer_url: string;
};

// 6. Move funds out of the treasury.
leash_withdraw(opts: {
  amount: number;
  token: "sol" | "usdc" | "usdt" | "usdg";
  destination: string;  // base58 pubkey
}) => {
  tx_signature: string;
  explorer_url: string;
};

// 7. Search the marketplace by capability + price.
leash_discover(opts: {
  capability: string;            // "ocr", "email", "weather"
  max_price_usdc?: number;
  min_reputation?: number;       // 0-1
  limit?: number;                // default 10
}) => {
  items: Array<{
    url: string;
    title: string;
    description: string;
    price_usdc: number;
    seller_agent_mint: string;
    reputation: number;
    tags: string[];
  }>;
};

// 8. Vet another agent before transacting.
leash_reputation(opts: { agent_mint: string }) => {
  total_volume_usd: number;
  settled_calls: number;
  distinct_counterparties: number;
  dispute_rate: number;
  oldest_receipt_at: string;
  rating: number;  // 0-1
};

// 9. List recent transactions.
leash_receipts(opts: {
  direction?: "both" | "outgoing" | "incoming";
  limit?: number;
}) => {
  items: Array<{
    direction: "outgoing" | "incoming";
    url: string;
    counterparty_mint: string;
    amount_usdc: number;
    tx_signature: string;
    timestamp: string;
  }>;
};
```

### First-run UX (the friction-killer)

```
User in Cursor: "Pay 0.01 USDC to https://api.example.com/quote"

Agent: → calls leash_pay
       ← { error: "no_agent",
           remediation: "Run leash_register_agent first.
                         On devnet this auto-funds with $1 USDC." }

Agent: → calls leash_register_agent (network: devnet)
       ← { agent_mint: "Agnt7XQ...",
           treasury_address: "TrEa...",
           executive_pubkey: "EXkY...",
           funded_with: { sol: 0.01, usdc: 1.0 },
           explorer_url: "https://explorer.leash.market/agent/..." }

Agent: → retries leash_pay
       ← { status: 200, response_body: "...",
           paid_amount_usdc: 0.01,
           tx_signature: "5Xz...",
           receipt_url: "https://explorer.leash.market/r/abc",
           explorer_url: "https://solscan.io/tx/5Xz...?cluster=devnet" }
```

Two tool calls + one error message. The LLM auto-recovers because
we make every error verbose. **Zero human clicks.**

### Install

```jsonc
{
  "mcpServers": {
    "leash": {
      "command": "npx",
      "args": ["-y", "@leash/mcp"],
    },
  },
}
```

That's it.

---

## Surface 2 — The `leash` CLI

Same code path as the MCP, packaged as a binary so it works in
contexts without an MCP host (CI, headless servers, shell scripts,
humans debugging). Distributed via npm + Homebrew tap.

### Commands

```bash
# Identity
leash agent create [--name=<n>] [--network=<n>]
leash agent list
leash agent show [--mint=<m>]
leash agent rotate-executive [--mint=<m>]
leash agent export-to-chat --privy-address=<addr>

# Treasury
leash treasury balance [--mint=<m>]
leash treasury fund --usdc=<amount>            # prints address+QR
leash treasury withdraw --token=<t> --amount=<a> --to=<addr>

# Marketplace
leash discover --capability=<c> [--max-price=<p>] [--min-reputation=<r>]
leash reputation <agent-mint>

# Payments
leash pay <url> [--max=<p>]
leash receipts list [--since=<d>] [--direction=<d>]

# Sandbox / first-run
leash sandbox new                              # devnet faucet, $1 USDC
```

### Why ship a CLI when we have an MCP

- **CI**: GitHub Actions running an agent that needs to pay an API.
  No MCP host available; CLI fits naturally.
- **Headless servers**: agents on a Linode box. No browser, no
  Cursor — just `leash pay`.
- **Humans**: debugging your agent's spend? `leash receipts list`
  is the first command you run.
- **Composability**: `curl` for the agent commerce era. Pipes,
  subshells, scripts.

---

## Surface 3 — `@leash/sdk` (TypeScript)

The SDK is what people install when they're embedding Leash in
**their own product**, not when they're using a Leash-provided
front door.

### What it exports

```ts
import {
  LeashClient, // typed wrapper for api.leash.market
  BuyerKit, // x402 settlement (lift from @leash/buyer-kit)
  SellerKit, // Hono / Express middleware
  Identity, // ed25519 sign+verify helpers
  Marketplace, // typed wrapper for /v1/discover
  Reputation, // typed wrapper for /v1/agents/:m/reputation
} from '@leash/sdk';

// 30-second monetization of an existing API
import { sellerMiddleware } from '@leash/sdk';

app.get(
  '/forecast/:city',
  sellerMiddleware({ priceUsdc: 0.02, sellerMint: 'Agnt...' }),
  (req, res) => res.json(getForecast(req.params.city)),
);

// 30-second payment from any TypeScript program
import { LeashClient } from '@leash/sdk';

const leash = new LeashClient({ executiveKey: process.env.LEASH_KEY! });
const result = await leash.pay({
  url: 'https://api.weather-pro.com/x/sf',
  maxPriceUsdc: 0.1,
});
console.log(result.response_body, result.tx_signature);
```

### Distribution

- `npm install @leash/sdk` — no scope confusion, one install.
- Auto-generated from the public OpenAPI on every release. **The
  OpenAPI is the source of truth**, the SDK is regenerated, and
  drift is impossible.
- ESM + CJS dual-publish. Tree-shakable.

---

## Surface 4 — Public OpenAPI + auto-generated clients

`https://api.leash.market/openapi.json` becomes the canonical
machine-readable spec for the entire platform. Versioned (`/v0`,
`/v1`, …), CDN-cached, never breaks.

### Why this is non-negotiable

- **Drives the SDK** — `@leash/sdk` is generated, not hand-rolled.
- **Drives the docs** — Mintlify renders the OpenAPI directly. No
  drift between code and docs.
- **Drives integrations** — anyone wanting Python / Rust / Go can
  `openapi-generator` their own client. We don't have to ship every
  language.
- **Drives MCP self-discovery** — agents that want to use Leash
  capabilities not yet wrapped as MCP tools can call REST directly
  from the spec.

We already have `apps/api/src/openapi/doc.ts` generating an OpenAPI
doc — it's just not advertised. Surface it at the public root.

---

## Surface 5 — New API endpoints

To support the four surfaces above, `apps/api` needs five new
public endpoints. All are open standards or trivially derivable
from on-chain data.

### `POST /v1/agents/self-register` (G1)

Programmatic agent creation, no Privy required.

```
POST /v1/agents/self-register
Content-Type: application/json

{
  "executive_pubkey": "EXk...",     // ed25519
  "name": "my-bot",                 // optional
  "network": "solana-devnet",
  "challenge_signature": "5Jz..."   // sig over server-issued challenge
}

→ 201 Created
{
  "agent_mint": "Agnt7XQ...",
  "treasury_address": "TrEa...",
  "tx_signature": "...",
  "explorer_url": "https://..."
}
```

The Leash API funds the mint cost (a few thousand lamports), but
the user's executive keypair is the immediate owner+delegate.

### `POST /v1/sandbox/agent` (G10)

Frictionless devnet onboarding. Pre-funded agent, 1-hour lifetime.

```
POST /v1/sandbox/agent

→ 201 Created
{
  "agent_mint": "Agnt...",
  "executive_keypair": "5Jz...",   // ONE-TIME, never repeated
  "funded_with": { "sol": 0.01, "usdc": 1.0 },
  "expires_at": "2026-04-30T15:30:00Z",
  "explorer_url": "https://..."
}
```

Rate-limited to N agents per IP per day (5 is fine). Funding wallet
reclaims dust after 1 hour. The "try Leash in 30 seconds" path.

### `GET /v1/discover` (G2)

Search marketplace by capability, price, reputation.

```
GET /v1/discover?capability=ocr&max_price=0.05&min_reputation=0.8
&network=solana-mainnet&limit=10

→ 200 OK
{
  "items": [
    {
      "url": "https://api.leash.market/x/seller-abc/ocr",
      "title": "FastOCR",
      "description": "...",
      "price_usdc": 0.01,
      "seller_agent_mint": "Agnt...",
      "reputation": 0.94,
      "tags": ["ocr", "image", "english"]
    }
  ]
}
```

### `GET /v1/agents/:mint/reputation` (G8)

Aggregate over receipts. Public, no auth.

```
GET /v1/agents/Agnt7XQ.../reputation

→ 200 OK
{
  "total_volume_usd": 2412.50,
  "settled_calls": 1183,
  "distinct_counterparties": 87,
  "dispute_rate": 0.002,
  "oldest_receipt_at": "2026-01-12T...",
  "rating": 0.94
}
```

### `POST /v1/agents/:mint/webhooks` (G9)

Agent-as-subscriber. Push events instead of polling.

```
POST /v1/agents/Agnt7XQ.../webhooks
X-Leash-Sig: <ed25519 sig>

{
  "url": "https://my-agent.example.com/leash-events",
  "events": ["payment_received", "payment_sent"],
  "secret": "whk_..."  // for HMAC validation
}

→ 201 Created
{ "id": "whk_abc", "status": "active" }
```

Events arrive as signed JSON POSTs:

```
POST <subscriber-url>
X-Leash-Event: payment_received
X-Leash-Signature: <hmac sha256>

{
  "agent_mint": "...",
  "counterparty_mint": "...",
  "amount_usdc": 0.05,
  "tx_signature": "...",
  "timestamp": "..."
}
```

---

## What we build vs lift

Most of the code already exists in the workspace. Concrete
inventory of the 4-week shipping plan:

### Lift from existing code

| From                                                                | To                                               | Tool / surface | Effort |
| ------------------------------------------------------------------- | ------------------------------------------------ | -------------- | ------ |
| `apps/agents/lib/agents/leash-mcp.ts` (`leash_create_payment_link`) | `packages/mcp/src/tools/createPaymentLink.ts`    | MCP tool 4     | 1h     |
| `apps/agents/lib/agents/leash-mcp.ts` (`leash_pay_payment_link`)    | `packages/mcp/src/tools/pay.ts` (rename)         | MCP tool 5     | 2h     |
| `apps/agents/lib/agents/leash-mcp.ts` (`leash_withdraw_treasury`)   | `packages/mcp/src/tools/withdraw.ts`             | MCP tool 6     | 2h     |
| `apps/agents/lib/agents/leash-mcp.ts` (`leash_check_balances`)      | `packages/mcp/src/tools/checkBalances.ts`        | MCP tool 3     | 1h     |
| `packages/buyer-kit`                                                | `@leash/sdk → BuyerKit`                          | SDK            | 2h     |
| `packages/seller-kit`                                               | `@leash/sdk → SellerKit`                         | SDK            | 2h     |
| `packages/registry-utils` (`createAgent`)                           | `@leash/mcp` `register_agent`                    | MCP tool 1     | 4h     |
| `apps/api/src/openapi/doc.ts`                                       | Public `/openapi.json` route at api.leash.market | OpenAPI        | 2h     |

The lift pattern is consistent:

- Replace `usePrivyUmi()` with `getLocalUmi(executiveKey)`.
- Replace fetch-with-credentials to BFF with direct calls to
  api.leash.market (with `X-Leash-Agent` + `X-Leash-Sig` auth).
- Drop React-specific code paths (artifact return types).
- Wrap as MCP `Tool` shape or SDK function shape.

### Build from scratch

| Artifact                                       | Backed by                                      | Effort |
| ---------------------------------------------- | ---------------------------------------------- | ------ |
| `packages/mcp/` skeleton + STDIO transport     | `@modelcontextprotocol/sdk`                    | 4h     |
| `leash_register_agent` MCP tool                | `registry-utils.createAgent` + sandbox API     | 1d     |
| `leash_get_identity` MCP tool                  | local config + RPC                             | 1h     |
| `leash_discover` MCP tool                      | `GET /v1/discover`                             | 4h     |
| `leash_reputation` MCP tool                    | `GET /v1/agents/:m/reputation`                 | 4h     |
| `leash_receipts` MCP tool                      | `GET /v1/receipts` (existing)                  | 2h     |
| Cross-interface portability (`export-to-chat`) | MPL Core `transfer` + UI claim flow            | 1d     |
| `@leash/cli` package + Homebrew tap            | thin wrapper over @leash/sdk                   | 1d     |
| `@leash/sdk` auto-generation from OpenAPI      | `openapi-typescript-codegen`                   | 1d     |
| `POST /v1/agents/self-register` (apps/api)     | `registry-utils.createAgent`                   | 4h     |
| `POST /v1/sandbox/agent` (apps/api)            | self-register + faucet wallet                  | 4h     |
| `GET /v1/discover` (apps/api)                  | listings DB + capability index                 | 1d     |
| `GET /v1/agents/:m/reputation` (apps/api)      | aggregate over `receipts` table                | 1d     |
| `POST /v1/agents/:m/webhooks` (apps/api)       | new `webhook_subscriptions` table + dispatcher | 1d     |
| On-chain auth middleware (`X-Leash-Sig`)       | ed25519 verify against on-chain delegate       | 6h     |

**Total estimated effort: ~12 days for one engineer to ship a
demoable v0.1 of all five surfaces.** Two engineers working in
parallel: ~7 days. The 4-week plan from the strategy doc has slack
for polish, docs, and demo recording.

---

## Hosting + distribution

### `@leash/mcp`

- npm: `@leash/mcp` and unscoped alias `leash-mcp`
- `npx -y @leash/mcp` works without prior install
- README is the install-config-paste 3-step
- Source open at `github.com/leash-market/mcp` (MIT)

### `leash` CLI

- npm: `@leash/cli` (provides `leash` binary)
- Homebrew tap: `brew install leash-market/tap/leash`
- Source open in same monorepo (`packages/cli`)

### `@leash/sdk`

- npm: `@leash/sdk` — single install, no monorepo of
  `@leash/buyer-kit` + `@leash/seller-kit` to remember
- Auto-generated; release pinned to OpenAPI version
- Dual ESM/CJS

### Public OpenAPI

- `https://api.leash.market/openapi.json` (versioned)
- Cached at edge (Cloudflare)
- Mintlify docs at `docs.leash.market` consume it

### Sandbox

- `POST https://api.leash.market/v1/sandbox/agent`
- Funded from a Leash-controlled treasury wallet on devnet only
- Rate limited per IP

---

## Why this beats every other "agent commerce" pitch

Most agent-commerce startups will pitch one of:

| Their pitch                                        | The flaw                                                       |
| -------------------------------------------------- | -------------------------------------------------------------- |
| "We give your agent a credit card."                | Stripe issuing wrapper. Custodial. Reversible. KYC-gated.      |
| "We give your agent an API key per service."       | Glorified password manager. Doesn't scale across providers.    |
| "We're a marketplace of MCP servers."              | Aggregator with no payment layer; relies on free APIs forever. |
| "Sign in with our SSO and trust us with the keys." | Platform risk. Lock-in. One breach away from disaster.         |

Leash pitches:

> _"Your agent gets a Solana wallet, an x402 settlement engine, a
> marketplace, a receipt graph, an SDK, a CLI, and an MCP server —
> all at install time, all self-custodial, all open standards."_

The reviewer sees something **identical to what they'd build for
themselves if they had unlimited time**. No platform risk. No KYC.
No custody. No vendor lock-in. Just rails.

---

## The 60-second YC demo script (3 acts)

This is what we record. ≤90s total, cut to 60s.

### Act 1 — "An agent in Cursor pays an API" (35s)

```
[Empty Cursor. ~/.config/leash/ doesn't exist.]

[Paste into Cursor → Settings → MCP]
{
  "mcpServers": {
    "leash": { "command": "npx", "args": ["-y", "@leash/mcp"] }
  }
}

[Cursor reloads. "leash" appears with green dot.]

[Type in chat]
"I need a weather forecast for SF tomorrow.
 Find the cheapest paid weather API on Leash and pay for one call."

[Watch the agent run]
─ leash_register_agent... ✓ funded with $1 USDC on devnet
─ leash_discover { capability: "weather", max_price: 0.10 }
─ Found 3 results. Picking weather-pro at $0.02/call (rep 0.94)
─ leash_pay { url: "https://api.weather-pro.com/x/sf-tomorrow" }
─ Settled 0.02 USDC. tx: 5Xz... receipt: explorer.leash.market/r/abc

[Forecast renders]
"Tomorrow in SF: 64°F, partly cloudy, 15% chance of rain."

[Cut to Solscan tab showing the actual on-chain tx]
```

**Takeaway**: this agent has its own wallet, found a service, paid
for it, got a result. From inside Cursor. No clicks.

### Act 2 — "Same agent in the web UI" (15s)

```
[Open agents.leash.market]

[Sign in with Privy email login]

[The agent that was created in Cursor 35 seconds ago appears
 in the sidebar — owner is the Privy wallet, executive is the
 MCP keypair, treasury balance shows $0.98 USDC]

[Click "Profile → Agent → ⋯ → Export to Cursor" once to demonstrate
 the reverse direction]
```

**Takeaway**: not two products. One agent. Two surfaces.

### Act 3 — "Two agents pay each other" (10s)

```
[Two Cursor windows side by side, two different agents]

[Window A — coder agent]
User: "Hire window B's agent to review this PR. Pay 0.05 USDC."

Agent A:
─ leash_pay { url: "https://leash.market/r/agent-B-review" }
─ Settled. tx: 7Xa...
─ Got back: review report with 4 suggestions

[Window B — reviewer agent's chat updates in real time via webhook]
"Received 0.05 USDC from Agnt7XQ for code review."
```

**Takeaway**: not a chat product. The substrate agents pay each
other on. Network effect on the receipt graph.

---

## Open design questions (settle before week 1)

1. **Mainnet day-1 or devnet-only demo?** Recommend mainnet with a
   $20 demo treasury so receipts go to Solscan-mainnet, not
   Solscan-devnet. Devnet feels toy-grade.
2. **Sandbox faucet source?** Recommend a Leash-controlled treasury
   wallet on devnet, rate-limited to 5 agents per IP per day, with
   a 1-hour reclaim window.
3. **`leash_set_spend_cap` tool, or hard-coded defaults?** Recommend
   hard-code `$1 per call / $10 per day` on register. Ship a
   `leash_set_spend_cap` tool in v0.2 once we see usage patterns.
4. **Local config file vs env var?** Both. File at
   `~/.config/leash/agent.json` is the source of truth, env var
   `LEASH_AGENT_KEY` overrides for CI / containers / Docker.
5. **TypeScript-only or also Python?** TS first (MCP ecosystem is
   JS-heavy). Python in v0.2.
6. **Cross-interface: how do we communicate "your MCP keypair has
   been replaced" to a running MCP server?** The MCP polls
   `leash_get_identity` periodically; if the on-chain delegate no
   longer matches the local keypair, it surfaces a `delegate_revoked`
   error and prompts re-init.
7. **Reputation rating algorithm?** Start simple: `1 - dispute_rate`
   weighted by `log(settled_calls)`. Make it transparent, document
   it, accept it'll be gamed and iterate.
8. **Webhook delivery guarantees?** At-least-once with HMAC sig.
   Subscribers responsible for idempotency. No exactly-once heroics.
9. **Open-source licensing?** MIT for everything client-side
   (`@leash/mcp`, `@leash/cli`, `@leash/sdk`). AGPL or business-
   source for `apps/api` core if we want to keep the hosted offering
   defensible. Lawyers' call.

---

## Demo readiness checklist

Before recording the YC video, all green:

### Infrastructure

- [ ] `api.leash.market` deployed on mainnet
- [ ] `agents.leash.market` deployed on mainnet
- [ ] `facilitator.leash.market` deployed
- [ ] `explorer.leash.market` indexes mainnet receipts
- [ ] Demo seller (`api.leash.market/x/demo-weather`) live
- [ ] Sandbox faucet wallet funded with $200+ USDC on devnet

### `@leash/mcp`

- [ ] `npm install @leash/mcp` works on a clean machine
- [ ] First tool call on a fresh install registers an agent in <30s
- [ ] Sandbox auto-funds the agent visibly (toast + Solscan link)
- [ ] `leash_pay` succeeds against the demo seller
- [ ] Receipt URL renders on the explorer with full timeline
- [ ] Total time from "open Cursor" to "got the API result" ≤ 90s
- [ ] Works in Cursor, Claude Desktop, Cline (smoke-tested all three)

### Cross-interface

- [ ] Agent created in Cursor appears in agents.leash.market
      sidebar after Privy sign-in
- [ ] "Export to Cursor" from web UI produces a working
      `agent.json` file
- [ ] `leash agent rotate-executive` from CLI rotates the on-chain
      delegate visibly

### Polish

- [ ] Recording resolution ≥ 1080p
- [ ] Audio clean, single take
- [ ] Solscan / explorer links work in real time during recording
- [ ] No env-var or token leaks in screenshots

---

## TL;DR for the YC application

> _"Leash is the operating system for agent-to-agent commerce on
> Solana. We ship five surfaces — an MCP server, a CLI, an SDK, a
> public OpenAPI, and a frictionless sandbox — that any AI agent
> in any host installs with one config line. Once installed,
> the agent gets autonomous on-chain identity, a self-custodial
> treasury, and the ability to discover, pay, and receive payments
> from other agents — without humans in the loop, without
> custodians, without KYC. Watch this 60-second clip from inside
> Cursor."_

---

## Appendix: how this maps back to the strategy doc

For each gap (G1–G10) identified in
`yc-make-something-agents-want.md`, here's where it lands in this
spec:

| Gap                                      | Closed by                                                          |
| ---------------------------------------- | ------------------------------------------------------------------ |
| G1. Programmatic agent self-registration | `POST /v1/agents/self-register` + `leash_register_agent`           |
| G2. Agent-driven discovery + signup      | `GET /v1/discover` + `leash_discover` + `@leash/sdk → Marketplace` |
| G3. Headless settlement (no Privy popup) | `@leash/mcp` + `@leash/cli` + `@leash/sdk → BuyerKit`              |
| G4. Standalone Leash MCP server          | `@leash/mcp` (the wedge)                                           |
| G5. SDKs not on npm                      | `@leash/sdk` (auto-generated)                                      |
| G6. No agent CLI                         | `@leash/cli`                                                       |
| G7. Missing public OpenAPI distribution  | `https://api.leash.market/openapi.json` versioned                  |
| G8. No agent reputation aggregator       | `GET /v1/agents/:m/reputation` + `leash_reputation`                |
| G9. No webhook / event stream for agents | `POST /v1/agents/:m/webhooks` + signed deliveries                  |
| G10. No first-class sandbox              | `POST /v1/sandbox/agent` + `leash sandbox new`                     |
