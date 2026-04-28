# Leash — Unified Build Plan

> **One source of truth.** Replaces the three earlier planning docs (deleted). Source vision lives in `LEASH.md`. This file is **what we build, in what order, to win the hackathon and raise on it.**

---

## 0. The 90-second pitch

**The internet was built for humans. Agents are arriving as economic actors and they're being forced to cosplay as humans — scraping pages, filling forms, clicking buttons. That's the wrong abstraction.**

**Leash rebuilds three primitives for agents:**

1. **Identity** — every agent is an on-chain MPL Core asset with a verifiable history (`leash` already does this)
2. **Money** — every agent has a treasury and pays per call via x402 stablecoins, in 400ms, for sub-cent fees (`leash` already does this)
3. **Capability** — every agent can discover, install, and call paid or free tools through an open MCP marketplace (this is what we're building now)

**Two surfaces, one infra:**

| Surface                   | Domain                  | One-liner                                                                  |
| ------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| **leash.market**          | The marketplace         | _The App Store for AI agents — discover, use, and get paid for MCP tools._ |
| **agent.leash.market**    | The agent product       | _Your agent. A wallet, an identity, and every tool it needs._              |
| **api.leash.market**      | The rails (built)       | _Stablecoin rails for autonomous agents._                                  |
| **explorer.leash.market** | The trust layer (built) | _Every agent action, on-chain, public, verifiable._                        |

The killer demo: an agent autonomously researches a topic, pays $0.001 per search, $5 USDC for an airtime top-up, all settled on-chain in under a minute, with every receipt visible on the explorer.

---

## 1. Decisions (settled — do not relitigate)

These were debated across earlier docs. Picking them now so we can build.

| Decision                   | Choice                                                                                                                                                       | Why                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **API keys**               | **Reuse `lsh_test_*` / `lsh_live_*`** from existing `apps/api`. Add a `scope` column to `api_keys` (`["agents", "marketplace", "admin"]`).                   | One auth system, network-aware, hashing + rate limits already done.                              |
| **Agent runtime location** | **Separate worker** at `apps/agent-runtime`, mirroring the indexer pattern.                                                                                  | LLM calls are long-running; serverless is wrong shape; scales independently.                     |
| **LLM funding (MVP)**      | **User brings their own LLM API key** (Anthropic / OpenAI / Groq), stored encrypted server-side.                                                             | Zero LLM cost risk for us. v2 can add a Leash-hosted, x402-gated LLM proxy as a paid capability. |
| **Treasury delegation**    | **Per-agent platform delegate**, auto-created on agent mint via Agent Tools `DelegateExecutionV1`. User signs once at create-time.                           | Smooth UX. Owner can revoke anytime.                                                             |
| **Hackathon scope**        | **Both surfaces ship.** `agent.leash.market` is the demo hero; `leash.market` is the supply story.                                                           | The two-sided narrative is what makes this fundable, not just buildable.                         |
| **Login**                  | **Privy** on both surfaces (email + wallet, embedded wallet on signup).                                                                                      | Reuse `apps/web/lib/privy-umi.ts`.                                                               |
| **Marketplace listings**   | **NEW entity** (`listings` table). Not a fork of `payment_links`. A listing has multiple tools, MCP-compatible schema, links to the seller's own MCP server. | Different shape; payment-links are static paywalls, listings are tool registries.                |
| **Real-time activity**     | **Reuse Leash API Redis pub/sub** (`task:{id}:activities` channel).                                                                                          | Already proven; explorer's live-refresh pattern works.                                           |
| **Build order**            | **`apps/agents` first**, then `apps/marketplace`.                                                                                                            | Demand drives supply. Without agents using tools, no developer wants to list.                    |

---

## 2. Architecture

```
                          ┌────────────────────────────┐
                          │   LEASH (already built)    │
                          │   - api.leash.market       │
                          │   - explorer.leash.market  │
                          │   - facilitator-devnet     │
                          │   - indexer worker         │
                          │   - Turso DB (shared)      │
                          │   - Redis pub/sub (shared) │
                          └─────────────▲──────────────┘
                                        │
                  ┌─────────────────────┼─────────────────────┐
                  │                     │                     │
       ┌──────────┴─────────┐ ┌─────────┴─────────┐ ┌─────────┴────────┐
       │ agent.leash.market │ │  leash.market     │ │  agent-runtime    │
       │ (Next.js)          │ │  (Next.js)        │ │  (Node worker)    │
       │                    │ │                   │ │                   │
       │ - Privy login      │ │ - Privy login     │ │ - Reads tasks     │
       │ - API key mgmt     │ │ - API key mgmt    │ │ - Calls LLM       │
       │ - Agent creation   │ │ - Browse / search │ │ - Calls MCPs      │
       │ - Funding UI       │ │ - List MCPs       │ │ - x402 buyer flow │
       │ - Task launcher    │ │ - Ratings/reviews │ │ - Emits activity  │
       │ - Live activity    │ │ - "List via chat" │ │   events to Redis │
       │ - Audit trail      │ │ - Dev dashboard   │ │                   │
       └────────────────────┘ └───────────────────┘ └───────────────────┘
```

**Service boundaries:**

- **`apps/api`** — single source of HTTP truth. Every other service reads/writes through it OR through the shared Turso DB.
- **`apps/agent-runtime`** — does NOT expose HTTP. Polls/subscribes for new tasks, runs them, emits activity events. Same deploy pattern as `apps/api/src/indexer/cli.ts`.
- **`apps/agents` & `apps/marketplace`** — pure UI + thin BFF. Talk to `apps/api` over HTTP using a per-user Leash API key.

---

## 3. Privy + API key flow (the user-explicit ask)

Both `agent.leash.market` and `leash.market` follow the **same** pattern.

### 3.1 Login

User clicks "Connect" → Privy modal → email or wallet. Privy returns:

- `user.id` (Privy DID)
- `user.linkedAccounts[].address` (Solana wallet, embedded if signup)
- JWT for our backend

We store one row per Privy user in a new `platform_users` table:

```sql
CREATE TABLE platform_users (
  privy_id      TEXT PRIMARY KEY,
  wallet        TEXT NOT NULL,         -- their Solana address
  email         TEXT,
  created_at    TEXT NOT NULL DEFAULT (...)
);
```

### 3.2 API key issuance page

Route: `/settings/api-keys` (same component on both surfaces, different default `scope`)

**UI:**

```
┌─────────────────────────────────────────────────────┐
│  API Keys                              [+ Create]   │
│  Use these to call the Leash API from your scripts. │
├─────────────────────────────────────────────────────┤
│  ● lsh_test_x7d…s3v6   "dev"      Devnet    [Revoke]│
│  ● lsh_live_a4k…m9p2   "prod"     Mainnet   [Revoke]│
└─────────────────────────────────────────────────────┘
```

**Create modal:**

```
Name:      [______________]
Network:   ( ) Devnet      ( ) Mainnet
Scope:     [x] Agents      [x] Marketplace      [ ] Admin
[ Cancel ]                      [ Create Key ]
```

### 3.3 Backend — the actual issuance call

The frontend calls **our existing `POST /v1/admin/api-keys`** (in `apps/api`), but **proxied** through a new Next.js route that:

1. Verifies the Privy JWT
2. Looks up `wallet` from Privy
3. Calls `apps/api` with the platform's admin secret on behalf of the user
4. Passes `owner_wallet` = the Privy wallet address (already required by Leash API)
5. Stores `(privy_id, key_id, scope[], name)` in a new join table:

```sql
CREATE TABLE platform_api_keys (
  privy_id      TEXT NOT NULL REFERENCES platform_users(privy_id),
  key_id        TEXT NOT NULL,           -- foreign to api_keys.id in api DB
  name          TEXT NOT NULL,
  scopes        TEXT NOT NULL,           -- JSON array
  created_at    TEXT NOT NULL,
  PRIMARY KEY (privy_id, key_id)
);
```

The plaintext key is shown **once** in the UI ("copy now, can't see it again") — same flow your existing admin endpoint already returns.

**Why this is clean:**

- No fork of the auth system
- Existing rate limits, hashing, redis cache, network scoping all keep working
- `owner_wallet` (already required after this morning's work) is now the Privy wallet — analytics/support all line up
- Revoke is just `DELETE /v1/admin/api-keys/{id}` (already exists)

### 3.4 Where the key is used

| Caller                                     | Header                                                               |
| ------------------------------------------ | -------------------------------------------------------------------- |
| User's CLI / curl                          | `Authorization: Bearer lsh_test_…`                                   |
| `agent.leash.market` browser → its own BFF | Privy session cookie (BFF holds the key server-side)                 |
| `agent-runtime` worker                     | Per-agent service account key (issued by platform on agent creation) |
| Marketplace MCP servers (sellers)          | Their own `lsh_*` key with `marketplace` scope                       |

---

## 4. The agent creation flow (the user-explicit ask)

Route: `agent.leash.market/agents/create`

The form is **conversational**, not a 6-tab wizard. One screen, one chat, the agent helper extracts structured config as the user talks.

```
┌──────────────────────────────────────────────────────┐
│ Tell me what your agent should do.                   │
│ ────────────────────────────────────────────────     │
│                                                      │
│ You: I want a Solana research agent that can search  │
│      the web and pull on-chain data. Keep it cheap.  │
│                                                      │
│ Helper: Got it. I'll set:                            │
│  • Model: Claude 3.5 Sonnet (good reasoning)         │
│  • System: "You are a Solana ecosystem research…"    │
│  • Capabilities: Web Search, Data Fetch              │
│  • Budget: $0.10/action, $1/task, $10/day            │
│                                                      │
│  You can also add tools by URL or describe one I     │
│  should look for in the marketplace.                 │
│                                                      │
│ You: Also add an airtime top-up tool                 │
│                                                      │
│ Helper: I found "USDC Airtime — MTN NG" by @degen,  │
│  $5/call, 4.8★ (220 reviews). Add it?               │
│                                                      │
│ You: yes                                             │
│                                                      │
│ Helper: Ready. Click [ Mint Agent → ] to deploy.     │
└──────────────────────────────────────────────────────┘
```

### 4.1 What's happening under the hood

1. The helper is itself a small LLM agent with `tools: ["search_marketplace", "set_field", "preview_listing"]`. It builds an `AgentDraft` JSON.
2. `search_marketplace` hits **`GET /v1/marketplace/listings?q=…`** — a new endpoint we add to `apps/api`.
3. When the user says "yes", we save the draft locally. They click **Mint Agent**, which:
   1. Mints the MPL Core asset via existing `@leash/registry-utils` (`createAgent`)
   2. Provisions treasury ATAs (already automated)
   3. Issues a per-agent service-account API key (scoped to `agents`)
   4. Auto-creates the platform delegate (`DelegateExecutionV1`) so `agent-runtime` can sign x402
   5. Writes the `agents` row with the resolved capabilities + budget
   6. Redirects to `/agents/[mint]/fund`

### 4.2 Adding tools "via prompt" (free or paid)

Three input modes, all in the same chat:

1. **Natural language** — "find me an image generation tool" → helper queries marketplace, shows top results, user picks
2. **Direct URL** — "use this MCP: https://airtime.example.com/mcp" → helper fetches `/.well-known/leash-mcp.json` (a contract every Leash-listed MCP must serve), validates schema, adds it
3. **Paste schema** — for power users; paste a tool-list JSON inline

The agent's installed tools become its "favorites." The runtime injects them into every LLM call as the `tools` array.

---

## 5. Build phases

### Phase 0 — already done ✅

- `apps/api` (Hono + Turso + Redis), `lsh_*` keys with `owner_wallet` required
- `apps/explorer` (live, deployed, Turso-backed)
- `indexer` worker (deployable, Dockerfile in repo)
- x402 buyer-kit, seller-kit, payment-links, facilitator (devnet live)
- e2e devnet test script (passes)

### Phase 1 — `agent.leash.market` MVP (target: 5 days)

**Day 1 — auth + keys**

- [ ] Scaffold `apps/agents/app/(auth)/login/page.tsx` with Privy provider (copy from `apps/web/lib/privy-umi.ts`)
- [ ] Add `platform_users`, `platform_api_keys` tables to a new `platform` Turso DB (or same DB, separate prefix)
- [ ] Build `/settings/api-keys` page (list / create / revoke)
- [ ] Add `apps/agents/app/api/keys/[route].ts` Next.js BFF that proxies to existing `POST /v1/admin/api-keys`

**Day 2 — agent creation backend**

- [ ] Add `POST /v1/agents` to `apps/api` (mints + provisions + delegates + writes `agents` row)
- [ ] Add `agents` table (mint, name, model, system_prompt, capabilities[], budget, owner_privy_id, ...)
- [ ] Reuse `@leash/registry-utils.createAgent`
- [ ] Auto-issue per-agent service key with scope `["agents"]`

**Day 3 — agent creation UI**

- [ ] Conversational create page (chat-driven helper)
- [ ] Helper LLM with `search_marketplace` / `set_field` tools
- [ ] Marketplace search returns 0 results in MVP — that's fine, "Add by URL" still works
- [ ] Mint button → success page with treasury address + fund instructions

**Day 4 — funding + task launcher**

- [ ] `/agents/[mint]/fund` page: balance, transfer USDC from connected wallet to treasury PDA
- [ ] `/agents/[mint]/tasks/new` page: prompt input, max budget for this run
- [ ] `POST /v1/agents/{mint}/tasks` (writes `tasks` row, sets status=pending)

**Day 5 — agent-runtime + activity feed**

- [ ] Create `apps/agent-runtime/src/cli.ts` (poll-based MVP, same shape as indexer)
- [ ] LLM loop with multi-provider client (Anthropic + OpenAI to start)
- [ ] MCP executor: free tools = direct fetch; paid tools = `/v1/buyer/quote → prepare → sign → execute`
- [ ] Emit `task:{id}:activities` events to Redis on every step
- [ ] `/agents/[mint]/tasks/[id]` page subscribes via SSE (reuse explorer's live-refresh pattern)

**End of Phase 1 deliverable:** A user can sign up, get an API key, mint an agent through chat, fund it, give it a task with a marketplace tool added by URL, and watch it execute live. **This is already a winning demo.**

### Phase 2 — `leash.market` MVP (target: 4 days after Phase 1)

**Day 6 — listings backend**

- [ ] Add `listings` table to Leash DB (id, slug, name, description, owner_wallet, endpoint, pricing_json, tools_json, stats_json, status, created_at)
- [ ] Add `POST/GET/PATCH/DELETE /v1/marketplace/listings` to `apps/api`
- [ ] Health-check worker: ping every listing's `/.well-known/leash-mcp.json` hourly
- [ ] Stats are derived: `installs` from `agents.capabilities` joins, `calls`/`revenue` from `receipts` joined by `tx_sig`

**Day 7 — browse + detail**

- [ ] `/browse` grid with category filter + search
- [ ] `/listing/[slug]` detail page: tools, pricing, stats, ratings, "Add to my agent" button
- [ ] Pull receipt counts from explorer DB to show real usage

**Day 8 — list via prompt + dev dashboard**

- [ ] `/list` conversational form (same helper pattern as agent creation)
- [ ] User pastes endpoint URL → helper fetches the MCP manifest → drafts the listing → submit
- [ ] `/business/dashboard`: revenue chart, top tools, settings

**Day 9 — ratings + reviews**

- [ ] Star ratings (one per Privy user per listing)
- [ ] Free-text reviews (markdown)
- [ ] "Trending" sort = weighted recency × calls × rating

**End of Phase 2:** Marketplace is live. Three demo listings (web search, data fetch, airtime) are seeded. The agent helper can search and install from real listings.

### Phase 3 — polish + demo (target: 3 days after Phase 2)

- [ ] Landing pages for both surfaces (Framer Motion hero, live counter from API)
- [ ] Status indicators throughout (live SSE, connection states)
- [ ] Copy pass — every CTA, every empty state
- [ ] Demo data seeding script: one demo agent, $5 funded, a saved task that always works
- [ ] Failure modes: out-of-funds, MCP 5xx, x402 verify failure — all show useful explorer-linked errors
- [ ] Record 90-second demo video (script below)
- [ ] Deploy: agents.leash.market (Vercel), leash.market (Vercel), agent-runtime (Railway worker)

---

## 6. The 90-second hackathon demo script

**[0:00–0:10] Hook**

> "The internet was built for humans. AI agents are arriving as economic actors. They need their own internet. We built it. On Solana."

**[0:10–0:30] Create the agent**

- Open `agent.leash.market`, log in with email
- Type: "Solana research agent. Add web search and a $5 airtime tool. Keep it cheap."
- Helper proposes config + finds the airtime listing on leash.market
- Click "Mint" — agent appears with on-chain address

**[0:30–0:45] Fund**

- Click "Fund" → 5 USDC transfer modal → sign with Privy embedded wallet
- Treasury balance updates live: 5.00 USDC

**[0:45–1:30] Run a task**

- New task: "Find the cheapest Solana RPC and recharge +234… with $5 airtime"
- Live activity feed:
  - 🧠 thinking — _"I need to search for RPC pricing..."_
  - 🔍 web_search — paid $0.001 USDC ✓
  - 🌐 data_fetch — paid $0.0002 USDC ✓
  - 📞 buy*airtime — paid $5.00 USDC ✓ — *"airtime delivered, ref #ABC123"\_
  - ✅ done — total $5.0012, 47 seconds
- Click any receipt → opens `explorer.leash.market` with live on-chain proof

**[1:30–1:30] The kicker**

> "Every payment was real, on Solana, in stablecoins, settled in 400ms. The airtime developer just earned 5 USDC. They listed in 5 minutes. This is the agent economy. Open. On-chain. Today."

---

## 7. Why this wins (judges) and why this is fundable (VCs)

### Hackathon judges

- **Live on-chain payments**, not mocked — every settle visible in explorer in real time
- **Two-sided marketplace**, not just a tool — supply story is rare in hackathon submissions
- **Solana-native** — 400ms finality + sub-cent fees make the demo _feel_ impossible
- **Polished UX** — Privy + chat-driven setup, not crypto-native form hell

### Investors (top of 10,000)

- **Timing**: MCP shipped 2025, x402 hit $24M/mo by Apr 2026, MIP-014 deployed Mar 2026 — all three primitives we depend on are <12 months old
- **Defensibility**: receipts are on-chain, not in our DB. Reputation accrues to the protocol, not us. Even if we get out-competed, the network effects compound on Leash.
- **Comparables**: Stripe ($95B), Twilio ($10B), Coinbase AgentKit (in-house at COIN). Equivalent layer for an agent-first internet → conservative comp is "Stripe but for autonomous software actors."
- **Revenue paths** (no need to choose now, but they exist):
  - 1% protocol fee on x402 settlements (already implemented)
  - Premium agent hosting (managed agent-runtime SaaS)
  - Verified developer program / marketplace placement
  - Treasury custody for enterprise agent fleets

### One-line moat

**"The only Solana-native runtime where AI agents have on-chain identity, programmable money, and an open marketplace of tools, all wired together."** No competitor has all four.

---

## 8. Cut list (do NOT build for the hackathon)

These came up in earlier docs. Defer all of them.

- ❌ Long-term memory / vector search — short-term + session is enough
- ❌ Skills marketplace (personality packs) — capability marketplace alone is the story
- ❌ x402-gated LLM proxy — user brings their own LLM key
- ❌ Multi-agent coordination
- ❌ NFT-tradeable skills
- ❌ Custom Ollama / self-hosted LLM endpoints
- ❌ Enterprise hosting tier
- ❌ Mobile apps

If a feature isn't in the 90-second demo, it doesn't ship for the demo.

---

## 9. Open questions to resolve in week 1

These don't block scaffolding but need answers before deploying:

1. **MCP "well-known" path** — `/.well-known/leash-mcp.json` is my proposal. Confirm before docs go out.
2. **Listing review** — manual approval for the first 50 listings, automated thereafter? Or trust + soft-flag from day 1?
3. **Ratings spam** — gate to one rating per Privy user per listing? Require minimum N receipts before rating?
4. **Agent runtime deployment** — Railway worker (matches indexer)? Or move to Modal/Trigger.dev for better long-job semantics?
5. **Custodial vs non-custodial treasury** — current plan delegates the treasury PDA to a platform key. Do we offer a "use your own key" mode for power users, or single-mode for MVP?

I lean: `/.well-known/leash-mcp.json` ✓ / manual review for 50 ✓ / one rating per user ✓ / Railway ✓ / single-mode MVP ✓ — but flag any disagreement.

---

## 10. Today's next move

Scaffold Phase 1 Day 1:

1. Set up Privy provider in `apps/agents` (copy from `apps/web/lib/privy-umi.ts`)
2. Add `platform_users` + `platform_api_keys` tables (migration on the existing Turso DB)
3. Build `/settings/api-keys` UI + the BFF route that calls `apps/api`'s admin endpoint

That's the smallest first step that lets every subsequent step happen.

---

**This plan is the only plan. Build from this. Update this when reality changes.**
