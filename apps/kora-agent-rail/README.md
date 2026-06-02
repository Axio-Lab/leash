# `@leashmarket/kora-agent-rail`

Kora Agent Rail is a partner-facing MVP that makes Kora local-currency services
consumable by AI agents without exposing Kora API keys to those agents.

The product idea is simple:

> Kora lets a business create a Kora Agent. Any AI agent can call that Kora
> Agent through HTTP, OpenAPI, or MCP. Kora executes local-currency financial
> services. Leash verifies the caller, enforces policy, and records receipts.

This is intentionally built as a Kora-owned rail on top of Leash infrastructure,
not as a Leash-only demo agent.

## What This Makes Possible

- AI agents can call Kora services without receiving Kora API keys.
- Kora merchants can expose controlled local-currency actions to agents.
- A merchant can define which services an agent may use, which currencies are
  allowed, and when human approval is required.
- Any external agent runtime can integrate: Leash agents, OpenAI-powered agents,
  Claude/Cursor agents, LangChain agents, CrewAI agents, custom backend agents,
  or MCP-compatible clients.
- Kora can publish agent-readable docs through `llms.txt`, OpenAPI, and a
  Leash MCP manifest.
- Money-moving requests are policy-gated before the Kora API is called.
- Executions produce local audit receipts with caller identity, policy decision,
  amount, currency, Kora reference, and status.
- Kora webhooks can update the execution record after settlement.

## Architecture

```txt
Any AI Agent
  -> Kora Agent Rail
  -> Leash caller verification and policy checks
  -> Kora local-currency APIs
  -> Kora webhook status updates
  -> Leash-style audit receipts
```

Kora owns:

- local-currency balances
- bank lookup and account resolution
- payouts
- checkout/payment collection
- virtual accounts
- payout status and webhooks
- Kora API credentials
- merchant relationship and compliance workflow

Leash powers:

- agent identity resolution
- signed caller authentication with `X-Leash-Sig`
- capability discovery
- policy decisions
- approval gating
- audit receipts
- agent-readable MCP/OpenAPI surfaces

## Implemented MVP Capabilities

The app exposes these agent-callable tools:

| Tool                          | Purpose                                      | Kora API coverage                             | Money movement |
| ----------------------------- | -------------------------------------------- | --------------------------------------------- | -------------- |
| `kora_get_agent_capabilities` | Return services exposed by a merchant agent. | Local rail metadata                           | No             |
| `kora_get_balance`            | Read Kora balances.                          | `GET /merchant/api/v1/balances`               | No             |
| `kora_list_banks`             | List supported banks by country.             | `GET /merchant/api/v1/misc/banks`             | No             |
| `kora_resolve_bank_account`   | Resolve a payout recipient bank account.     | `POST /merchant/api/v1/misc/banks/resolve`    | No             |
| `kora_create_payout`          | Create a local-currency payout.              | `POST /merchant/api/v1/transactions/disburse` | Yes            |
| `kora_get_payout_status`      | Read payout status by transaction reference. | `GET /merchant/api/v1/transactions/:ref`      | No             |
| `kora_list_payouts`           | List recent payouts.                         | `GET /merchant/api/v1/payouts`                | No             |
| `kora_create_checkout`        | Create a checkout/payment collection.        | `POST /merchant/api/v1/charges/initialize`    | Yes            |
| `kora_create_virtual_account` | Create a virtual bank account.               | `POST /merchant/api/v1/virtual-bank-account`  | No             |

The first production demo should focus on:

- balance check
- bank list
- bank account resolution
- local-currency payout
- payout status
- payout webhook update
- policy denial and approval-required states

## Agent-Facing Surfaces

Discovery:

- `GET /health`
- `GET /llms.txt`
- `GET /openapi.json`
- `GET /.well-known/leash-mcp.json`
- `GET /mcp`

MCP-style JSON-RPC:

- `POST /mcp`
- supports `initialize`
- supports `tools/list`
- supports `tools/call`

Direct HTTP tools:

- `POST /tools/kora_get_agent_capabilities`
- `POST /tools/kora_get_balance`
- `POST /tools/kora_list_banks`
- `POST /tools/kora_resolve_bank_account`
- `POST /tools/kora_create_payout`
- `POST /tools/kora_get_payout_status`
- `POST /tools/kora_list_payouts`
- `POST /tools/kora_create_checkout`
- `POST /tools/kora_create_virtual_account`

Merchant/admin demo routes:

- `GET /kora-agents`
- `POST /kora-agents`
- `GET /kora-agents/:id`
- `PUT /kora-agents/:id/policy`
- `PUT /kora-agents/:id/capabilities`
- `POST /kora-agents/:id/publish`
- `GET /kora-agents/:id/executions`
- `GET /agents/:id/capabilities`

Webhook route:

- `POST /kora/webhooks/payout`

## Authentication Model

Agents do not use Kora API keys. Kora credentials stay server-side in env.

For local smoke testing, you can disable Leash enforcement:

```env
KORA_REQUIRE_LEASH=false
KORA_REQUIRE_LEASH_SIGNATURE=false
```

For production-style protected calls:

```env
KORA_REQUIRE_LEASH=true
KORA_REQUIRE_LEASH_SIGNATURE=true
```

Protected tools then require:

```txt
X-Leash-Agent: <agent mint>
X-Leash-Timestamp: <ISO timestamp>
X-Leash-Sig: <base58 ed25519 signature>
```

`X-Leash-Sig` signs the exact request envelope:

```txt
METHOD
PATH_WITH_QUERY
TIMESTAMP
SHA256(BODY)
AGENT_MINT
```

Agents can generate those headers with `signRequest` from `@leashmarket/sdk`.

`X-Leash-Handle` and `X-Leash-Domain` can be used for identity resolution when
signature enforcement is disabled, but money-moving production calls should use
`X-Leash-Agent` plus `X-Leash-Sig`.

## Policy Model

Each Kora Agent has a local policy:

```ts
type KoraAgentPolicy = {
  allowedCapabilities: KoraToolName[];
  allowedCurrencies: string[];
  requireVerifiedAgent: boolean;
  allowedCallers: {
    mints: string[];
    handles: string[];
    domains: string[];
  };
  maxPayoutAmount: number;
  dailyPayoutLimit: number;
  approvalThreshold: number;
};
```

The policy engine can return:

- `allowed`: call Kora now.
- `denied`: do not call Kora.
- `approval_required`: pause before calling Kora.

Examples of blocked conditions:

- caller identity is missing
- caller signature is invalid
- capability is disabled
- currency is not allowed
- payout amount is above the per-payout limit
- payout would exceed the daily limit
- caller is not in an explicit allow list

## Environment

Copy the example file:

```bash
cp apps/kora-agent-rail/.env.example apps/kora-agent-rail/.env
```

Required for real Kora sandbox calls:

```env
KORA_PUBLIC_KEY=pk_test_...
KORA_SECRET_KEY=sk_test_...
KORA_BASE_URL=https://api.korapay.com
```

Local app config:

```env
PORT=4300
KORA_AGENT_RAIL_PUBLIC_URL=http://localhost:4300
```

Leash verification:

```env
LEASH_API_URL=https://api.leash.market
KORA_REQUIRE_LEASH=true
KORA_REQUIRE_LEASH_SIGNATURE=true
```

Default demo policy:

```env
KORA_DEFAULT_AGENT_ID=demo-kora-agent
KORA_ALLOWED_CURRENCIES=NGN,KES,GHS,ZAR,XOF,XAF,EGP,USD
KORA_MAX_PAYOUT_AMOUNT=100000
KORA_DAILY_PAYOUT_LIMIT=500000
KORA_APPROVAL_THRESHOLD=50000
```

Optional receipt mirroring:

```env
LEASH_RECEIPT_WEBHOOK_URL=https://...
```

Never commit real Kora keys. The app reads credentials only from env and never
returns them through OpenAPI, `llms.txt`, the MCP manifest, or tool responses.

## Run Locally

```bash
pnpm install
pnpm --filter @leashmarket/kora-agent-rail dev
```

Default local URL:

```txt
http://localhost:4300
```

## Test Discovery

```bash
curl http://localhost:4300/health
curl http://localhost:4300/llms.txt
curl http://localhost:4300/openapi.json
curl http://localhost:4300/.well-known/leash-mcp.json
curl http://localhost:4300/mcp
```

## Test Direct HTTP Tools

For local smoke tests, set:

```env
KORA_REQUIRE_LEASH=false
KORA_REQUIRE_LEASH_SIGNATURE=false
```

List capabilities:

```bash
curl -X POST http://localhost:4300/tools/kora_get_agent_capabilities \
  -H 'content-type: application/json' \
  -d '{}'
```

List Nigerian banks:

```bash
curl -X POST http://localhost:4300/tools/kora_list_banks \
  -H 'content-type: application/json' \
  -d '{"country_code":"NG"}'
```

Read balances:

```bash
curl -X POST http://localhost:4300/tools/kora_get_balance \
  -H 'content-type: application/json' \
  -d '{}'
```

Resolve a bank account:

```bash
curl -X POST http://localhost:4300/tools/kora_resolve_bank_account \
  -H 'content-type: application/json' \
  -d '{
    "bank": "044",
    "account": "0000000000",
    "currency": "NGN"
  }'
```

Test approval gating without calling Kora:

```bash
curl -X POST http://localhost:4300/tools/kora_create_payout \
  -H 'content-type: application/json' \
  -d '{
    "reference": "INV-APPROVAL-001",
    "amount": 75000,
    "currency": "NGN",
    "destination": {
      "type": "bank_account",
      "bank_account": {
        "bank": "044",
        "account": "0000000000"
      },
      "customer": {
        "email": "test@example.com"
      }
    }
  }'
```

Expected result:

```json
{
  "kind": "kora_tool_result",
  "status": "approval_required"
}
```

Create an in-policy payout with Kora sandbox data:

```bash
curl -X POST http://localhost:4300/tools/kora_create_payout \
  -H 'content-type: application/json' \
  -d '{
    "reference": "INV-1042",
    "amount": 25000,
    "currency": "NGN",
    "destination": {
      "type": "bank_account",
      "bank_account": {
        "bank": "044",
        "account": "0000000000"
      },
      "customer": {
        "email": "test@example.com"
      }
    },
    "narration": "Invoice INV-1042"
  }'
```

Use Kora's current sandbox test data for real payout execution.

## Test MCP

List MCP tools:

```bash
curl -X POST http://localhost:4300/mcp \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

Call a tool through MCP JSON-RPC:

```bash
curl -X POST http://localhost:4300/mcp \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "kora_list_banks",
      "arguments": {
        "country_code": "NG"
      }
    }
  }'
```

## Test Webhook Updates

After creating a payout with reference `INV-1042`, simulate a Kora webhook:

```bash
curl -X POST http://localhost:4300/kora/webhooks/payout \
  -H 'content-type: application/json' \
  -d '{
    "event": "transfer.success",
    "data": {
      "reference": "INV-1042",
      "status": "success",
      "currency": "NGN",
      "amount": 25000
    }
  }'
```

Then inspect executions:

```bash
curl http://localhost:4300/kora-agents/demo-kora-agent/executions
```

## Create A Merchant Kora Agent

```bash
curl -X POST http://localhost:4300/kora-agents \
  -H 'content-type: application/json' \
  -d '{
    "id": "acme-finance",
    "name": "Acme Finance Agent",
    "description": "Local-currency finance operations for Acme."
  }'
```

Publish/discover it:

```bash
curl -X POST http://localhost:4300/kora-agents/acme-finance/publish
curl http://localhost:4300/agents/acme-finance/capabilities
```

Call a tool for that merchant agent:

```bash
curl -X POST http://localhost:4300/tools/kora_list_banks \
  -H 'content-type: application/json' \
  -d '{
    "agent_id": "acme-finance",
    "country_code": "NG"
  }'
```

## Receipt Shape

Every tool call records a local receipt:

```json
{
  "kind": "kora_agent_rail_receipt",
  "receipt_hash": "...",
  "agent_id": "demo-kora-agent",
  "tool": "kora_create_payout",
  "decision": "allowed",
  "amount": 25000,
  "currency": "NGN",
  "caller": {
    "selector": {
      "mint": "..."
    },
    "resolved_mint": "...",
    "trust_status": "verified"
  },
  "kora_reference": "INV-1042",
  "timestamp": "..."
}
```

If `LEASH_RECEIPT_WEBHOOK_URL` is set, the app also mirrors receipts to that
URL. Receipt mirroring failures do not block the Kora response path.

## Automated Checks

```bash
pnpm --filter @leashmarket/kora-agent-rail typecheck
pnpm --filter @leashmarket/kora-agent-rail test
pnpm --filter @leashmarket/kora-agent-rail build
pnpm exec prettier --check apps/kora-agent-rail
```

The tests cover:

- policy allow/deny/approval decisions
- public discovery surfaces
- no Kora secret leakage in discovery responses
- local-currency payout execution path
- approval-required payout path that does not call Kora
- payout webhook execution updates

## Production Notes

- Rotate any Kora key that has been pasted into chat, logs, or screenshots.
- Keep `KORA_REQUIRE_LEASH_SIGNATURE=true` for money-moving production calls.
- Put merchant/admin routes behind Kora auth before exposing the service.
- Replace the in-memory store with durable storage before a real pilot.
- Add idempotency handling around payout references.
- Validate Kora webhook signatures once Kora's signing mechanism is configured.
- Add human approval execution endpoints before approving held payouts.
- Add richer Leash receipt ingestion once the production receipt sink is selected.

## Expansion Path

Next Kora services that can become agent-callable:

- mobile money payouts
- bulk payouts
- payout beneficiaries
- payment links and checkout collections
- virtual account creation and transaction lookup
- refunds
- balance history
- currency conversion
- identity verification
- card issuing and card controls

The long-term product is a Kora dashboard button:

> Create Kora Agent -> choose services -> set local-currency policy -> publish
> MCP/OpenAPI/llms.txt -> let trusted AI agents operate safely.
