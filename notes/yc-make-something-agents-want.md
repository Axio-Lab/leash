# Leash × "Make Something Agents Want"

_Strategic answer to the YC RFP, written against the actual Leash codebase
(2026-04-30). Audience: Leash founders + YC reviewer._

---

## TL;DR

**Verdict: Strong fit, wrong front door.**

Leash already _is_ the foundation the RFP describes — on-chain agent
identity, autonomous treasury, x402 payments, tool marketplace, audit
explorer. The infrastructure is agent-native. But the only door an
agent can walk through today is a Next.js app behind a Privy login —
i.e. a human-first chat product sitting on top of agent-first rails.

The RFP isn't asking for "a chat app for AI agents". It's asking for
the substrate _other agents depend on_. Leash should stop selling the
chat and start selling the rails:

1. Ship a **`leash` MCP server** so any Claude / Cursor / GPT agent gets
   wallet + payment + discovery in one `mcp.json` line.
2. Make every chat-driven flow (mint, fund, pay, withdraw, discover)
   reachable headlessly via **REST + SDK + CLI**, with no Privy click.
3. Publish **`@leash/sdk`** to npm and **`leash`** to crates / pip /
   Homebrew. Agents install you the same way humans install Stripe.

If we do those three things in the next 4 weeks, the RFP answer
becomes trivial: _Leash is the operating system agents pay each other
on. The chat is just our showroom._

---

## Does Leash meet the RFP?

The RFP names three pillars. Score:

| Pillar                                                     | Score | Where we win                                                                                                   | Where we leak human-first assumptions                                                                      |
| ---------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Machine-readable interfaces** (APIs, MCPs, CLIs)         | 7/10  | 23 REST routes in `apps/api`, OpenAPI doc, x402 paywalls, in-process MCP tools (`leash_pay_payment_link` etc.) | No standalone MCP server. No CLI. SDKs not on npm. Most flows assume a Privy session cookie.               |
| **Programmatic discovery + signup, no human in the loop**  | 4/10  | `apps/marketplace` lists tools, `llms.txt` exists, identity is on-chain & introspectable                       | Agent-self-registration requires a human-clicked Privy stepper. Signing up for a listed tool isn't an API. |
| **Instant use** (zero-click activation, programmatic auth) | 5/10  | x402 + SPL delegation = "approve once, agent spends N times" is real and shipped                               | Every settlement currently re-prompts the user in Privy. No headless executive mode. No agent-issued keys. |

**Average: 5.3 / 10.** Strong bones, weak surface.

Compare to the typical RFP applicant — most score 2/10 because they
have a chat UI and a vibes deck. Leash already shipped the hard part.
The remaining work is _packaging_, not invention.

---

## Why Leash is genuinely agent-first infrastructure (don't lose this)

These are the moats that already exist. The pitch should lead with them.

1. **On-chain agent identity via MPL Core + EIP-8004** — Every Leash
   agent is an MPL Core asset on Solana with `RegistrationV1` metadata.
   That's a _portable, verifiable, machine-readable_ identity that
   isn't bound to our DB. Other agents can verify a Leash agent's
   provenance with a single RPC call. No incumbent has this.

2. **Autonomous treasury with delegated spend** — Each agent owns a
   PDA-derived treasury. The owner approves an executive (typically a
   wallet) once, with per-token caps. After that the agent spends
   autonomously up to its on-chain ceiling. This is Stripe Connect for
   agents, except settlement is final on Solana, not reversible by
   chargeback.

3. **x402 + facilitator** — We implement the open x402 paywall
   standard (`apps/api/src/routes/paywall.ts`, `packages/facilitator`).
   That means _any_ HTTP service can monetize itself by returning
   `402 Payment Required` with a price, and any Leash agent can pay it
   without bespoke integration. Agent-to-agent commerce, no platform
   lock-in.

4. **`@leash/buyer-kit` + `@leash/seller-kit`** — Open-source SDKs
   already shaped for npm publication (`"private": false`). Buyer side
   handles the 402 dance. Seller side wraps any Hono / Next route in
   one line of middleware. Two devs in two languages can transact
   without ever speaking.

5. **Audit explorer + receipts** — Every payment writes a receipt.
   `apps/explorer` indexes them. This is the "credit bureau for agents"
   — agents can vet other agents on track record before transacting.

6. **In-process MCP tools** — `apps/agents/lib/agents/leash-mcp.ts`
   already implements `leash_create_payment_link`,
   `leash_pay_payment_link`, `leash_withdraw_treasury`,
   `leash_check_balances` as MCP tools. **80% of the work to ship a
   public Leash MCP server is already done** — it just lives inside
   the chat app instead of being its own binary.

The RFP says _"the new agent-first software won't come from incumbents
bolting on agent support"_. That's literally the Stripe / AWS / Auth0
of agent commerce. We're already positioned there. Don't bury it.

---

## The gaps (where the human-first assumption leaks)

Concrete failure modes a hostile YC reviewer would hit if they tried
to use Leash _as an agent_, with no human:

### G1. An agent can't sign itself up

**Today**: Visit agents.leash.market → Privy email login → wallet
connect → 3-step stepper (identity / services / operator) → mint.

**Required**: `POST /v1/agents/self-register` accepting an Ed25519
public key + signed challenge, returning `{ mint, executive_key,
treasury }`. No human, no email, no clicks. The agent's own keypair
becomes the executive.

### G2. An agent can't sign up for a listed tool

**Today**: Marketplace lists tools, but "trying" one means clicking
through the human creator UI.

**Required**: `GET /v1/discover?capability=email&max_price=0.05` →
returns an array of x402-priced URLs. The agent calls the URL, gets
the 402 quote, settles via buyer-kit, gets the response. Zero
discovery friction.

### G3. Every settlement currently re-prompts the user

**Today**: Pay card in chat → user clicks "Approve & pay" → Privy
sigreq → settle. Even though the on-chain SPL delegate is already set.

**Required**: Two modes:

- **Attended mode** (current): user approves each Pay card. Good for
  trust-building.
- **Headless mode**: agents with a stored executive private key (held
  by the agent, not Leash) settle silently against their cap until
  they hit the per-day ceiling. Just-shipped per-action gate already
  enforces the policy — we just need a code path that doesn't go
  through the React UI.

### G4. No standalone Leash MCP server

**Today**: Leash MCP tools are bound to the chat app's Anthropic
session.

**Required**: `npx @leash/mcp` spins up a STDIO MCP server. Any
host (Claude Desktop, Cursor, Cline, Continue) installs Leash with
one config line and gets `leash_*` tools. **This is the demo that
wins YC.** Founders open Cursor, type "pay this URL: x402://...",
the agent does the whole flow without leaving the IDE.

### G5. SDKs not on npm

**Today**: `@leash/buyer-kit`, `@leash/seller-kit`,
`@leash/registry-utils` are workspace-only.

**Required**: `npm publish` all three. Pin a stable v0.1 API. Add a
README with copy-pasteable "monetize your API in 30 seconds"
example. Same for Python (`pip install leash`) and Rust
(`cargo add leash`). Agents installed in any runtime get Leash for
free.

### G6. No agent CLI

**Required**: `leash` binary on Homebrew + npm.

```bash
leash agent create --name=my-bot
leash treasury fund --usdc=10
leash discover --capability=ocr --max-price=0.01
leash pay https://api.example.com/quote
leash receipts list --since=2026-04-01
```

Headless agents on servers without browsers need this. So do humans
debugging agent behaviour.

### G7. Missing public OpenAPI distribution

**Today**: `apps/api` has `/openapi.json` (per `openapi/doc.ts`) but
it's not advertised, not versioned, not on a CDN, not used to
generate clients.

**Required**: `https://api.leash.market/openapi.json` published,
versioned (`v0.1`), and used to auto-generate `@leash/sdk` for
TypeScript + Python on every release. Plus an MCP-flavoured spec at
`/llms.txt` that points agents at the right entrypoints.

### G8. No agent reputation aggregator

**Today**: Receipts are on-chain but no one rolls them up.

**Required**: `GET /v1/agents/<mint>/reputation` →
`{ total_volume_usd, distinct_counterparties, dispute_rate,
oldest_receipt_at }`. Other agents query this before transacting.
Build "Stripe Atlas for agents" trust without becoming a gatekeeper.

### G9. No webhook / event subscription for agents

**Today**: `apps/api/src/routes/webhooks.ts` exists but is creator-
facing.

**Required**: Agent-as-subscriber. `POST /v1/agents/<mint>/webhooks
{ url, events: ['payment_received', 'task_completed'] }` so an agent
running on its own server can react to its treasury changing without
polling.

### G10. No first-class sandbox

**Today**: Devnet works but the path from "I'm a curious agent" to
"my first paid call succeeded on devnet" requires reading docs.

**Required**: `POST /v1/sandbox/agent` → returns a fully-funded
devnet agent with $1 USDC, 60-minute lifetime. Frictionless try-out
for any LLM agent that lands on the docs.

---

## The wedge: ship a `leash` MCP server first

Of everything above, the single highest-leverage move is **G4: a
standalone Leash MCP server**. Reasons:

1. **Distribution channel that already exists.** Claude Desktop,
   Cursor, Cline, Continue, GPT-5 Pro, etc. all read the same MCP
   config format. One config line == new acquisition channel.
2. **80% of the implementation already lives in
   `apps/agents/lib/agents/leash-mcp.ts`.** Lift, refactor, ship.
3. **Killer demo.** "Watch this: I tell my Cursor agent to pay an
   x402 URL, it does it, here's the on-chain receipt." That single
   30-second clip is the YC application.
4. **It forces every other gap to close.** A standalone MCP can't
   rely on a Privy session cookie, so we build self-register (G1) and
   headless settlement (G3) by necessity. A standalone MCP needs a
   discovery tool, so we build the discovery API (G2).

Concretely, the package is `@leash/mcp` (or `leash-mcp` for
prefix-less install), exposes:

- `leash_register_agent` — first-call provisioning (G1)
- `leash_check_balances` — already implemented
- `leash_create_payment_link` — already implemented
- `leash_pay` — programmatic x402 settlement
- `leash_withdraw` — already implemented
- `leash_discover` — search the marketplace by capability/price (G2)
- `leash_reputation` — read on-chain reputation (G8)
- `leash_subscribe_events` — webhook config (G9)

User config:

```json
{
  "mcpServers": {
    "leash": {
      "command": "npx",
      "args": ["-y", "@leash/mcp"],
      "env": { "LEASH_AGENT_KEY": "lsh_..." }
    }
  }
}
```

That's it. Every Cursor/Claude user becomes a potential Leash agent
the moment they paste that block.

---

## 4-week plan

Aggressive but realistic, given how much already exists.

### Week 1 — `@leash/mcp` (the wedge)

- [ ] New package `packages/mcp/` with STDIO MCP transport.
- [ ] Lift `leash_*` tools from `apps/agents/lib/agents/leash-mcp.ts`
      into the new package.
- [ ] Replace Privy-bound auth with `LEASH_AGENT_KEY` env var (a
      Leash-issued API key tied to a specific on-chain agent).
- [ ] Add `leash_register_agent` (calls G1 endpoint we'll ship in
      week 2).
- [ ] Publish to npm under MIT.
- [ ] Record a 60-second demo: "Cursor pays x402 URL via Leash".

### Week 2 — Headless registration + key issuance

- [ ] `POST /v1/agents/self-register` (apps/api). Body: Ed25519 pub
      key + signed challenge. Mints an agent with the supplied key
      as the executive. No Privy.
- [ ] `POST /v1/keys` issues `lsh_live_*` API keys scoped to a
      single agent mint.
- [ ] Headless executive flow: buyer-kit accepts a raw secret-key
      signer (no Privy adapter) and settles silently up to the
      on-chain cap.
- [ ] Document at docs.leash.market/agents/register.

### Week 3 — Discovery + reputation

- [ ] `GET /v1/discover` with filters: `capability`, `max_price`,
      `network`, `min_reputation`.
- [ ] `GET /v1/agents/:mint/reputation` aggregator over receipts.
- [ ] `leash_discover` and `leash_reputation` MCP tools.
- [ ] Marketplace UI gets a "Get the agent prompt" button that
      copies the exact x402 URL.

### Week 4 — CLI + polish

- [ ] `@leash/cli` (Node, ships via npm + Homebrew tap).
- [ ] `leash agent create / pay / discover / receipts`.
- [ ] Public OpenAPI at `https://api.leash.market/openapi.json`,
      versioned `v0.1`.
- [ ] `@leash/sdk` (TypeScript) auto-generated from OpenAPI.
- [ ] Sandbox endpoint: `POST /v1/sandbox/agent` → funded devnet
      agent with 1-hour lifetime.

### Stretch (week 5+)

- [ ] Python SDK (`leash` on PyPI).
- [ ] Webhook subscription API for agents (G9).
- [ ] Hosted facilitator at `facilitator.leash.market`.
- [ ] Cargo crate for Rust agents (Solana/Substrate-native fit).

---

## Positioning for the YC application

Don't pitch the chat. Pitch the rails. The chat is the showroom.

### One-liner

> Leash is the **operating system for agent-to-agent commerce**:
> on-chain identity, treasury, payments, and discovery — installed
> in any AI agent with one MCP config line.

### Three-bullet pitch

- **Identity.** Every agent is an MPL Core asset on Solana with
  EIP-8004 RegistrationV1 metadata — verifiable by any other agent
  without trusting Leash.
- **Money.** x402-native paywalls + per-action SPL delegation:
  "approve once, agent spends N times under your cap". No human in
  the loop after onboarding.
- **Discovery.** A marketplace of x402-priced tools, browsable from
  any agent runtime via a single MCP tool. Stripe + Twilio + Yelp,
  collapsed for agents.

### What makes this defensible

- Network effect on the receipt graph: every paid call deepens our
  reputation moat. Other agents query Leash _because_ Leash sees
  the most cross-agent volume.
- Integration moat via MCP: once Cursor/Claude/Cline users have
  Leash configured, switching cost is "rotate keys" — trivial for
  us, painful for a competitor trying to displace us.
- Open standards (x402, MPL Core, EIP-8004) prevent platform-risk
  pushback while still giving us the trust + UX layer.

### The acid test for YC

> **Show, don't tell.** Open Cursor, type _"pay 0.01 USDC to
> https://api.example.com/quote and tell me the result"_, watch it
> work end-to-end with an on-chain receipt URL. Demo over.

If the 4-week plan ships, we can record that exact demo on May 30th.

---

## Risks + open questions

### R1. Privy lock-in for end-users

Privy is great for the human chat product, but the headless flow
must not depend on it. Mitigation: introduce a `LeashSigner`
abstraction (already partially there in `apps/agents/lib/privy-svm-signer.ts`)
that has Privy and raw-keypair implementations. Headless mode picks
the latter.

### R2. Key custody for agents

If an agent holds its own executive private key, where? On the
agent's host machine. We never see it. That's good for trust but
bad for "I lost my agent key" recovery. Mitigation: optional Leash-
hosted custody as a paid feature later. Don't bake it in v1.

### R3. Devnet vs mainnet positioning

The agents app is currently devnet-default. For YC the demo must be
mainnet. That requires:

- Real USDC on mainnet for the demo agent.
- `NEXT_PUBLIC_SOLANA_NETWORK=solana-mainnet` build of the chat.
- Mainnet facilitator (`facilitator.leash.market`).

Already supported by config — just needs the deploy switch.

### R4. The chat product becomes a distraction

Every hour spent polishing the chat UI is an hour not spent on the
rails. **Hard rule for the next 4 weeks: no chat-only features
unless they're necessary to demo a rail.** The chat exists to drive
SDK adoption, not as the product itself.

### R5. Open-standards vs proprietary value capture

We support x402 (open). We use MPL Core (open). We propose
EIP-8004 (open). What's proprietary?

- The receipt graph + reputation API.
- The hosted facilitator (we run the relays, others can too).
- The marketplace (network effect on listing-discovery).
- The MCP server's UX polish + opinionated defaults.

That's enough to build a venture-scale company on without being a
walled garden.

### R6. Legal: are we a money transmitter?

Open question for the lawyers. Leash never custodies user funds —
treasuries are owned by the agents themselves, executives are user-
held. We're closer to "wallet software vendor" than "money
transmitter". Still, get an opinion before mainnet launch.

---

## Decision points (need answers before starting week 1)

1. **Do we cut the consumer chat from the YC pitch entirely**, or
   keep it as the "showroom"? Recommendation: keep it, but stop
   investing in chat-only features.
2. **Do we ship `@leash/mcp` under the Leash org or as a neutrally-
   branded MCP package** to maximize adoption? Recommendation:
   Leash-branded but MIT, so it's clearly _our_ traffic acquisition
   layer.
3. **Devnet-only demo or mainnet day-1?** Recommendation: mainnet
   day-1 with a $20 demo treasury. Devnet feels like a toy to
   reviewers.
4. **Headless executive: keypair-on-host or keypair-via-Leash-API?**
   Recommendation: host-only for v1. Leash-hosted custody is a v2
   pricing lever.

---

## Appendix: how Leash already maps to the RFP language

> _"agents are already browsing the web, doing research, making
> purchases, and managing legacy CRMs"_

Leash agents make on-chain purchases today. Composio integration
covers CRM tool calls. Web browsing is upstream of us — agents
already do it; Leash is what kicks in once they need to **pay**.

> _"agents need machine-readable interfaces like APIs, MCPs, and
> CLIs"_

We have the API. We have MCP tools (just not packaged). We don't
have the CLI yet. **Three of three covered after week 4.**

> _"agents also need thorough documentation, to enable them to
> discover, sign up for, and instantly start using new tools
> programmatically, without needing a human in the loop"_

Right now: API docs exist (`apps/docs`), `llms.txt` exists, but
sign-up requires Privy and discovery requires the marketplace UI.
**Closed by weeks 2–3.**

> _"the new agent-first software won't come from incumbents bolting
> on agent support, it'll come from startups that build explicitly
> for agents as first-class citizens"_

Stripe doesn't have on-chain agent identity. Auth0 doesn't have a
treasury per agent. AWS doesn't have x402 settlement. We do, and
it's all live today on devnet, code in `git log`.

> _"Make Something Agents Want"_

Agents want: identity they can prove, money they can spend, tools
they can discover, and a paper trail others trust. Leash ships all
four. We just need to put a door on the building that's marked
`/* for agents */` instead of `/* for humans driving agents */`.
