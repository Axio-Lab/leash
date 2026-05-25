# Leash

> **Leash is the identity layer for AI agents.**

Leash gives every AI agent a portable onchain identity, a treasury it can
receive into, delegated authority it can operate with, policy that constrains
what it may do, capabilities other agents can discover, and receipts that prove
what happened.

The identity is the primitive. Payments, marketplace listings, automations,
external chat connectors, MCP tools, API endpoints, and proof trails are
capabilities attached to that identity.

## What Leash Provides

| Layer          | What ships                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Agent identity | MPL Core agent mint, registration metadata, handles, verified domains, claims, and public identity profiles.            |
| Treasury       | Asset Signer PDA treasury for SOL and SPL stables, with owner-driven withdrawals and spend delegation.                  |
| Policy         | Rules for budgets, hosts, triggers, limits, kill switches, and spend controls.                                          |
| Capabilities   | Native Leash listings, pay.sh/pay-skills APIs, MCP tools, paid endpoints, data sources, connectors, and automations.    |
| Verification   | Identity resolve, allow/warn/deny trust decisions, reputation checks, capability matching, and operator health signals. |
| Proof trails   | Hash-chained receipts, events, operator history, delivery attempts, and explorer-visible activity.                      |
| Privacy        | Product V1 selective disclosure links for private capability cards, claims, and redacted receipt details.               |

## Product Surfaces

| Surface         | Path                                       | Purpose                                                                                                                          |
| --------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Agent app       | [`apps/agents`](apps/agents)               | Create and manage agent identities, connect tools, set policy, chat, run automations, and control agents from WhatsApp/Telegram. |
| Marketplace     | [`apps/marketplace`](apps/marketplace)     | Discover capabilities across native Leash listings and pay.sh/pay-skills APIs; list identity-backed paid services.               |
| Explorer        | [`apps/explorer`](apps/explorer)           | Public explorer for agent identities, events, transactions, receipts, reputation, disclosures, and proof trails.                 |
| API             | [`apps/api`](apps/api)                     | Hono + OpenAPI service for identity, marketplace, prepare/sign/submit, receipts, automations, webhooks, and platform data.       |
| Docs            | [`apps/docs`](apps/docs)                   | Mintlify docs for concepts, API reference, SDKs, MCP, buyer/seller kits, schemas, and standards.                                 |
| Playground      | [`apps/playground`](apps/playground)       | Interactive testbed for minting agents, x402 payments, buyer/seller flows, receipts, and schema validation.                      |
| Facilitator app | [`apps/facilitator`](apps/facilitator)     | App/runtime surface for x402/MPP facilitation.                                                                                   |
| Agent runtime   | [`apps/agent-runtime`](apps/agent-runtime) | Worker that runs agent loops, calls MCP tools, settles payments, and emits activity.                                             |

## Published Packages

| Package                                                  | Purpose                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`@leashmarket/sdk`](packages/sdk)                       | TypeScript client for identity lookup, discovery, verification, disclosures, webhooks, payment-link CRUD, and API calls.       |
| [`@leashmarket/cli`](packages/cli)                       | Human CLI for minting, resolving, verifying, funding, paying, operating identities, and creating hosted x402/MPP paywalls.     |
| [`@leashmarket/mcp`](packages/mcp)                       | Standalone MCP server that gives AI hosts Leash tools over STDIO, including payment-link creation and x402/MPP payment.        |
| [`@leashmarket/mcp-core`](packages/mcp-core)             | Reusable MCP tool implementations and helpers, including payment-link schemas shared by CLI/MCP/agent hosts.                   |
| [`@leashmarket/schemas`](packages/schemas)               | Canonical schemas for receipts, rules, registration, identity profiles, verification decisions, disclosures, and capabilities. |
| [`@leashmarket/core`](packages/core)                     | Low-level x402, MPP, policy, treasury, receipt, token, and explorer utilities.                                                 |
| [`@leashmarket/registry-utils`](packages/registry-utils) | Metaplex agent identity creation, registration, delegation, operator, and treasury helpers.                                    |
| [`@leashmarket/buyer-kit`](packages/buyer-kit)           | Buyer-side helpers for agent payments, identity preflight, and x402/MPP calls.                                                 |
| [`@leashmarket/seller-kit`](packages/seller-kit)         | Seller-side middleware for identity-backed paid APIs and receipt creation.                                                     |
| [`@leashmarket/facilitator`](packages/facilitator)       | x402/MPP facilitator server and settlement logic.                                                                              |
| [`@leashmarket/runner`](packages/runner)                 | Local runner for receipt feeds, payment links, endpoints, and kill-switch behavior.                                            |
| [`@leashmarket/testing`](packages/testing)               | Fixtures, conformance helpers, and mock facilitator/server utilities.                                                          |

Hosted payment links can monetize existing APIs with x402 or MPP. Set
`metadata.upstream_url` (CLI `--upstream-url`) to forward paid calls to an
existing GET or POST endpoint after settlement. For `POST` endpoints, creators
can also set `metadata.expected_request_body` (CLI `--expected-body '{}'`) to
describe the JSON shape buyers should send. The buyer still sends the real body
later to the hosted `/x/{id}` URL; Leash settles payment first, strips payment
headers, then forwards that body to the upstream endpoint.

## Requirements

- Node **>= 20**
- [pnpm](https://pnpm.io) **9**

## Quick Start

```bash
pnpm install
pnpm run ci
```

For a faster local loop:

```bash
pnpm turbo run build
pnpm turbo run test typecheck lint
```

## Run The Main Stack Locally

```bash
# 1. Migrate and seed the local API database.
pnpm --filter @leashmarket/api db:migrate
pnpm --filter @leashmarket/api seed:demo

# 2. Start the backend and runtime.
pnpm --filter @leashmarket/api dev             # :8787
pnpm --filter @leashmarket/agent-runtime dev

# 3. Start product surfaces.
pnpm --filter @leashmarket/agents dev          # :4100
pnpm --filter @leashmarket/marketplace dev     # :4200
pnpm --filter @leashmarket/explorer dev        # :3000
pnpm --filter @leashmarket/docs dev
pnpm --filter @leashmarket/playground dev
```

Useful local URLs:

- Agent app: `http://localhost:4100`
- Marketplace: `http://localhost:4200`
- Explorer: `http://localhost:3000`
- API health: `http://localhost:8787/health`
- OpenAPI: `http://localhost:8787/openapi.json`

## x402 Demo Without The Hosted App

```bash
# Terminal 1: seller API
pnpm --filter @leashmarket/seller-demo start

# Terminal 2: buyer agent
SELLER_URL=http://localhost:3001 pnpm --filter @leashmarket/buyer-demo start

# Terminal 3: receipt runner
pnpm --filter @leashmarket/runner start

# Terminal 4: playground
pnpm --filter @leashmarket/playground dev
```

Scripted outline:

```bash
pnpm exec tsx scripts/e2e-demo.ts
```

## Common Environment Variables

| Variable                 | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `SOLANA_RPC`             | RPC URL for demos, kits, and local chain reads.                   |
| `LEASH_API_URL`          | API base URL used by apps/packages when not using the hosted API. |
| `LEASH_API_ADMIN_SECRET` | Admin secret used by trusted BFF/API-to-API calls.                |
| `LEASH_NETWORK`          | Runtime network, usually `solana-devnet` or `solana-mainnet`.     |
| `LEASH_RUNNER_URL`       | Runner URL for receipt feeds and playground proxying.             |
| `LEASH_FACILITATOR_URL`  | Facilitator URL for x402/MPP settlement.                          |
| `LEASH_KILL`             | `1` enables the environment kill switch.                          |
| `LEASH_ONCHAIN_PAUSED`   | `1` mirrors an onchain pause from an external watcher.            |
| `AGENT_ASSET`            | Agent mint used by demos and local scripts.                       |

App-specific variables live in each app/package README or `.env.example` where
available.

## Docs

```bash
pnpm gen:docs
pnpm --filter @leashmarket/docs dev
```

The docs are also designed for coding agents:

- `https://docs.leash.market/llms.txt`
- `https://docs.leash.market/llms-full.txt`
- `https://api.leash.market/openapi.json`

## Docker

Split stack:

```bash
docker compose up --build
```

Merged demo profile:

```bash
docker compose --profile merged up --build merged-demo
```

Railway-ready Dockerfiles live in [`docker/`](docker). Frontends can also run
on Vercel with the existing Next.js standalone output.

| Service       | Dockerfile                                                           | Suggested host    |
| ------------- | -------------------------------------------------------------------- | ----------------- |
| API           | [`docker/api.Dockerfile`](docker/api.Dockerfile)                     | Railway           |
| Agent runtime | [`docker/agent-runtime.Dockerfile`](docker/agent-runtime.Dockerfile) | Railway           |
| Agent app     | [`docker/agents.Dockerfile`](docker/agents.Dockerfile)               | Vercel            |
| Marketplace   | [`docker/marketplace.Dockerfile`](docker/marketplace.Dockerfile)     | Vercel            |
| Explorer      | [`docker/explorer.Dockerfile`](docker/explorer.Dockerfile)           | Vercel or Railway |
| Playground    | [`docker/playground.Dockerfile`](docker/playground.Dockerfile)       | Vercel or Railway |
| Facilitator   | [`docker/facilitator.Dockerfile`](docker/facilitator.Dockerfile)     | Railway           |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).
