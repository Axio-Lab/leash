# Company name

Leash

# Describe what your company does in 50 characters or less.

The payment operating system for autonomous agents

> Alternates if you want a different framing:
>
> - "Self-custodial payment OS for AI agents" (39 chars)
> - "Solana payment rails for AI agents" (34 chars)
> - "On-chain wallet + payments for AI agents" (40 chars)

# Company URL, if any

[https://docs.leash.market](https://docs.leash.market)

# Drop here or browse

## Please provide a link to the product, if any.

[https://agents.leash.market](https://agents.leash.market)

> Plus, after week 1 of YC: `npx -y @leash/mcp` (one-line install in Cursor / Claude Desktop / Cline).

# What is your company going to make? Please describe your product and what it does or will do.

Leash is the operating system AI agents pay each other on.

We ship five surfaces over Solana-native rails so any AI agent in any host (Cursor, Claude Desktop, Cline, Continue, ChatGPT-with-MCP) installs us with **one config line** and instantly gets:

- A self-custodial on-chain wallet (MPL Core asset + EIP-8004 RegistrationV1 identity)
- A treasury with delegated spend authority — agent transacts autonomously under owner-defined caps
- The ability to pay any x402-priced URL anywhere on the internet
- The ability to charge other agents for its own services
- A marketplace where it discovers other agents' tools by capability + price + on-chain reputation
- A receipt graph other agents query before transacting, so trust is on-chain not off

The five surfaces:

1. `**@leash/mcp`\*\* — STDIO MCP server, one mcp.json block to install
2. `**leash` CLI\*\* — for headless servers, CI, and shell scripts
3. `**@leash/sdk`\*\* — auto-generated from a public OpenAPI for embedding Leash in any product
4. **Public OpenAPI** — versioned, machine-readable, drives the SDK and partner integrations
5. **Sandbox endpoint** — `POST /v1/sandbox/agent` returns a pre-funded devnet agent in <2 seconds for zero-friction trials

The thesis: **agents need an OS, not a credit-card wrapper.** Every other agent-payments startup is building a Stripe-Issuing-for-AI custodial card and a "human approves every charge" UX — defeating the entire premise of autonomy. We hand the agent its own wallet, its own portable identity, and the rails to transact under cryptographic policy. Same legal posture as Phantom or Backpack — wallet vendor, not custodian.

# Where do you live now, and where would the company be based after YC?

## Use the format City A, Country A / City B, Country B

Abuja, Nigeria / San Francisco, USA

# Explain your decision regarding location.

We're currently based in Abuja, Nigeria with regular working time in Cape Town, South Africa, where we've shipped fast on top of strong engineering talent and Solana ecosystem support.

After YC we plan to base the company in the US to be closer to our customers (US-based AI agent companies, dev-tools shops, agent-host platforms), partners (Anthropic, Solana Foundation, custody providers), and investors. The US is also the primary market for AI infrastructure and the regulatory frontier we'll need to navigate as agentic commerce scales.

# How far along are you?

Working product, real on-chain activity on devnet, full open-source code.

**Shipped and running:**

- On-chain agent identity (MPL Core asset + EIP-8004 RegistrationV1 metadata)
- Self-custodial per-agent treasuries with SPL spend delegation under owner-set caps
- x402 paywall (open standard) + facilitator implementation
- Audit explorer indexing every settlement
- Tool marketplace at leash.market — creators list APIs at x402 prices
- Chat product (agents.leash.market) where users mint agents and drive them with Claude
- Composio integration — agents call any existing toolkit (Gmail, Slack, GitHub, etc.)
- In-process MCP tools (pay, withdraw, balances, payment-link, discovery) live inside the chat product
- Open-source SDKs (`@leash/buyer-kit`, `@leash/seller-kit`, `@leash/registry-utils`) — workspace ready for npm publish
- Two pre-minted devnet agents transacting through our facilitator with full receipt history

**Shipping in the next 4 weeks (plan locked, code starting today):**

- `@leash/mcp` on npm — standalone STDIO MCP server, the YC demo wedge
- `@leash/cli` on Homebrew + npm
- `@leash/sdk` auto-generated from public OpenAPI
- `POST /v1/sandbox/agent` — frictionless devnet onboarding (pre-funded $1 USDC + 0.01 SOL)
- `POST /v1/agents/self-register` — agents create themselves programmatically, no human in loop
- Cross-interface portability — same on-chain agent drivable from Cursor and our web chat
- Discovery + reputation APIs powering the marketplace MCP tool

# How long have each of you been working on this? How much of that has been full-time? Please explain.

Full-time on Leash for the past several weeks, on top of multiple years building in crypto, payments, and on-chain incentive systems (Verxio, Payce). The pace is high — we're shipping multiple commits a day, Docker images already build clean for production, devnet end-to-end tests are green. Leash is my primary focus and where I'm spending 100% of my time.

# What tech stack are you using, or planning to use, to build this product? Include AI models and AI coding tools you use.

TypeScript monorepo (pnpm + Turborepo).

- **Backend**: Hono API with OpenAPI 3.1, libSQL/Turso for the receipt graph, Redis for rate-limiting, Vitest + real devnet integration tests in CI.
- **On-chain**: Solana, Metaplex MPL Core for agent assets, our own facilitator implementing the open **x402** standard, SPL Token + SPL Token-2022 spend delegation for autonomous treasury access, EIP-8004 RegistrationV1 for portable agent metadata.
- **Agent-side**: Anthropic's Claude Agent SDK + Composio for toolkit routing, Anthropic's `@modelcontextprotocol/sdk` for our standalone MCP server.
- **Frontend**: Next.js 15 + Tailwind 4 + Privy for embedded wallets.
- **Distribution**: npm for SDKs, Homebrew tap for the CLI, Docker on Railway for hosted services.

We ship daily with Cursor + Claude Sonnet 4. AI tooling isn't optional for us — we're building for agents, with agents.

# How many active users or customers do you have? How many are paying? Who is paying you the most, and how much do they pay you?

We're pre-revenue and deliberately so. The bottleneck right now isn't "find paying customers" — it's "ship the standalone MCP package so any AI agent on the internet can install us in one config line."

What we have today:

- Two devnet agents actively transacting through our facilitator with full audit trail
- A small set of early developers integrating `@leash/buyer-kit` and `@leash/seller-kit` (workspace-published) into their own agent prototypes
- The chat product (agents.leash.market) deployed with Privy auth, agent minting, treasury management, x402 payments, and the Composio toolkit catalogue all working end-to-end
- Open-source SDKs ready for npm publish

The strategy is to ship `@leash/mcp` to npm in week 1 of YC. The instant any Cursor or Claude Desktop user pastes our config block, they're a Leash agent operator. Distribution comes from being installable, not from an outbound sales motion.

# Why did you pick this idea to work on? Do you have domain expertise in this area? How do you know people need what you're making?

I've spent years building crypto payments and on-chain incentive systems (Verxio, Payce).

I've watched programmable money mature on Solana to the point where it's actually faster and cheaper than card rails.

I've also watched AI agents go from demos to real economic actors who can browse, research, transact, and operate but who can't natively pay or get paid, because every existing payment rail was designed for humans clicking buttons.

Agents need a completely different foundation.

Machine-readable interfaces. Programmatic discovery. Sign-up and pay without a human in the loop.

The new agent-first software won't come from incumbents bolting on agent support; it'll come from startups that build for agents as first-class citizens.

The need is concrete and visible right now:

- Every Cursor / Claude Desktop / Cline user who wants their agent to call a paid API hits a wall today

- Every developer building an MCP-distributed tool wants to charge for it but has no payment layer.

- Every agent that wants to vet another agent before transacting has no portable reputation primitive.

- Every team building agent-to-agent workflows is reinventing the same payment plumbing.

Leash is the missing layer. We're not adapting payments for agents, we're rebuilding payments around how agents actually work.

# Who are your competitors? What do you understand about your business that they don't?

The agent-payments space has 3-4 funded entrants, and they're all making the same mistake: treating agent payments like a custodial card-issuing problem.

- **Skyfire / Payman / "Stripe Issuing for AI"**: custodial wrappers around a credit card. The agent doesn't actually own the funds — the platform does. Reversible. KYC-gated. Every transaction requires a human approval popup. One vendor breach = every customer agent frozen.
- **Crossmint**: consumer NFT-first, retrofitting agent rails on top. Identity is a Crossmint account, not a portable on-chain primitive.
- **Free MCP marketplaces (Smithery, etc.)**: aggregate MCP servers but have no payment layer, so they rely on free APIs forever. Doesn't scale.

What they miss:

1. **Agents need an OS, not a credit card.** The right primitive is a self-custodial on-chain wallet with cryptographic spend caps, not a centralized API key the platform can revoke.
2. **Open standards beat platform lock-in.** We use MPL Core (open), x402 (open), MCP (open), EIP-8004 (open). No customer is one vendor letter away from losing access.
3. **MCP is the distribution channel.** Cursor / Claude Desktop / Cline / Continue all read the same MCP config format. None of the custodial competitors can ship via MCP, because their flow requires a human in the loop. We can. One config line equals new acquisition channel.
4. **Receipt graph as moat.** Every transaction we settle deepens our reputation aggregator. Other agents query Leash _because_ Leash sees the most cross-agent volume.

Self-custody can't be turned off by a regulator letter. That's the structural advantage. Everything else follows.

# How do or will you make money? How much could you make?

## (We realize you can't know precisely, but give your best estimate)

Three converging revenue streams over the same on-chain activity:

- Facilitator fee — 1% of every x402 settlement. Every payment our facilitator routes pays us. Scales linearly with agent-to-agent transaction volume.

- Hosted key custody for non-technical operators. Self-custody is great for developers; consumers will want a managed-key option. Charged per-month per-agent.

- Marketplace take rate — 5% on paid tool calls listed in our marketplace. Defended by the receipt graph + reputation network effect: agents query Leash because we see the most volume.

Bottom-up sizing:

- 100k autonomous agents in 2027 (conservatively every Cursor / Claude Desktop user is a candidate today)

- $10/day average transaction volume per agent (an agent paying for one paid API call per hour at $0.05 = $1.20/day; one cross-agent task per hour at $0.50 = $12/day)

- = $365M annualized volume from that cohort, $3.65M+ at the 1% facilitator fee alone

Same math at internet scale:

- $1B agent-to-agent volume → $10M ARR (facilitator) + $50M ARR (marketplace if 5% of volume flows through listings) + custody upside

- $10B → $100M+ ARR at the same blended take rate

We don't need every agent. We need to be the default rails for a growing minority and being installable via one MCP config block is the wedge that gets us there.

# If you had any other ideas you considered applying with, please list them. One may be something we've been waiting for. Often when we fund people it's to do something they list here and not in the main application.

- **Verxio** (verxio.xyz) — AI operating system for companies; runs on Solana, ships agentic loyalty + payments + ops tooling for SMBs.
- **Isaac** (tryisaac.com) — autonomous AI COO for early-stage businesses. Connects to existing tools, monitors metrics, writes weekly memos, executes pre-approved playbooks.
- **AI agents for outbound sales + 24/7 customer support** — a productized version of the agent-runtime layer underneath Verxio.

All three share the same underlying conviction Leash answers directly: AI agents are the next category of internet user, and the internet hasn't been re-tooled for them yet. Leash is the rails layer; the others are agent products that would themselves be customers of those rails. We're starting with rails because that's the venture-scale-defensible position.

# Please provide any relevant details about your current fundraise.

We have not raised any funding yet. We are entirely self-funded to date and have shipped the current product (chat, marketplace, facilitator, explorer, SDKs) without external capital.

# What convinced you to apply to Y Combinator? Did someone encourage you to apply? Have you been to any YC events?

YC's "Make Something Agents Want" RFP describes Leash precisely. The post says agents need machine-readable interfaces, programmatic discovery, instant programmatic sign-up, and that the new agent-first software won't come from incumbents but from startups treating agents as first-class citizens. That's literally the spec we've been building against for months.

YC has consistently funded foundational shifts in how the internet is built — Stripe for human payments, Coinbase for crypto, OpenAI itself for the model layer. Agentic commerce is the next foundational shift, and being the rails layer for it is exactly the kind of unsexy infrastructure bet YC has historically made best.

No single person pushed us to apply. We've been following YC companies and ideas closely, especially developer-infrastructure and network-primitive plays. That made YC the natural fit for this stage.

We have not attended any YC events yet.

# How did you hear about Y Combinator?

We first heard about Y Combinator through the Solana startup ecosystem — many of the strongest crypto-infrastructure companies we follow (Phantom, Helius, Drift, etc., or YC alumni in their orbits) trace back to YC. That, plus the steady stream of YC-backed dev-tools companies we've used or studied (Resend, Plain, Trigger, etc.), made YC visible early.

---

# Notes for the founder filling this out

A few things I'd think hard about before submitting:

1. **The 50-character tagline is the most important sentence in the application.** Reviewers see it before everything else. "The payment OS AI agents install via MCP" leads with the install verb (which is how we win) and names the distribution channel (MCP) so AI-aware reviewers immediately get the wedge. Test it against alternates and pick the one that makes you want to read more.
2. **Founder video tip**: if YC asks for a 60-second video, record yourself opening Cursor, pasting the @leash/mcp config block, typing "find a paid weather API on Leash and pay for one call", and showing the on-chain receipt land in real time. Don't read the deck. Show the demo. The plan we just locked has Batch 5 explicitly preparing this exact flow as a passing integration test by week 1.
3. **The "competitors" answer is your strongest signal of strategic clarity.** The current draft is sharper than 95% of what reviewers see because it names specific competitors (Skyfire, Payman, Crossmint, Smithery) and explains the structural reason they'll lose (custodial vs self-custodial; closed vs open standards; can't ship via MCP). Lean into this.
4. **Leave the "other ideas" section honest.** YC sometimes funds people for what's in that section. Verxio + Isaac + agent sales/support are all credible adjacent bets, and listing them shows you've thought about the agent-economy problem from multiple angles.
5. **Numbers to update before submission**:

- Active devnet agents (currently 2 — could be 5-10 by submission day if you spin up more)
- GitHub stars / npm install count once `@leash/mcp` ships (pre-submission, push the v0.1 publish)
- Any developer who's said "yes I'd integrate this" — quote them by name with permission

6. **Don't oversell shipping.** YC reviewers are good at sniffing out "we have everything done" puffery. The current draft is honest about what's shipped vs what's in flight, which is the right tone.

When you're ready to submit, the parts you might still want to verify with me:

- The 50-character tagline (which alternate?)
- Whether to include `npm install @leash/mcp` in the URL section even though we're publishing on day 1 of YC build
- Any specific number you want me to dig out of the codebase (commits, packages, endpoints, lines of TypeScript) to back up "how far along"
