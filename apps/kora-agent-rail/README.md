# `@leashmarket/kora-agent-rail`

Kora Agent Rail is a partner-facing MVP that makes Kora local-currency services
consumable by AI agents without exposing Kora API keys to those agents.

Kora stays the execution layer for balances, bank lookup, payouts, checkout,
virtual accounts, and webhooks. Leash is the trust layer for caller identity,
policy decisions, approvals, discovery, and receipts.

## Run Locally

```bash
cp apps/kora-agent-rail/.env.example apps/kora-agent-rail/.env
pnpm --filter @leashmarket/kora-agent-rail dev
```

Set real sandbox keys in `.env`:

```env
KORA_PUBLIC_KEY=pk_test_...
KORA_SECRET_KEY=sk_test_...
KORA_BASE_URL=https://api.korapay.com
```

Do not commit real Kora keys. The app reads credentials only from env and never
returns them through OpenAPI, `llms.txt`, the MCP manifest, or tool responses.

## Agent-Facing Surfaces

- `GET /llms.txt`
- `GET /openapi.json`
- `GET /.well-known/leash-mcp.json`
- `POST /mcp`
- `POST /tools/kora_get_balance`
- `POST /tools/kora_list_banks`
- `POST /tools/kora_resolve_bank_account`
- `POST /tools/kora_create_payout`
- `POST /tools/kora_get_payout_status`
- `POST /tools/kora_list_payouts`
- `POST /tools/kora_create_checkout`
- `POST /tools/kora_create_virtual_account`

Protected tools require Leash caller identity headers. For production-style
verification, callers sign the exact request envelope with `X-Leash-Sig`.

```txt
X-Leash-Agent: <agent mint>
X-Leash-Timestamp: <ISO timestamp>
X-Leash-Sig: <base58 ed25519 signature>
```

`X-Leash-Handle` and `X-Leash-Domain` can be used for identity resolution when
signature enforcement is disabled, but money-moving production calls should use
`X-Leash-Agent` plus `X-Leash-Sig`.

## First Demo Flow

1. A merchant creates or uses the default Kora Agent.
2. An external AI agent discovers the rail through `/llms.txt`, OpenAPI, or MCP.
3. The AI agent asks for a payout in local currency.
4. The rail verifies the caller through Leash.
5. The rail checks the merchant Kora Agent policy.
6. If allowed, the rail calls Kora server-side with `KORA_SECRET_KEY`.
7. Kora webhook updates the execution record.
8. The rail emits a Leash-style receipt for audit.

## Test

```bash
pnpm --filter @leashmarket/kora-agent-rail typecheck
pnpm --filter @leashmarket/kora-agent-rail test
pnpm --filter @leashmarket/kora-agent-rail build
```
