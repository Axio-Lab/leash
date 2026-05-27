# @leashmarket/mcp-core

Host-agnostic core for every Leash MCP surface.

Defines the `LeashHost` runtime contract, `LeashTool` primitive, and the full
`LEASH_TOOLS` catalogue that all adapters (`@leashmarket/mcp`, Claude Agent SDK,
browser runtimes) iterate over.

## Install

```bash
npm install @leashmarket/mcp-core
# or
pnpm add @leashmarket/mcp-core
```

## What lives here

| Export                     | Purpose                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `LeashHost`                | Runtime contract every host implements (wallet, RPC, API key, …)                                       |
| `LeashTool` / `defineTool` | Tool-definition primitive (name, Zod schema, typed handler)                                            |
| `LEASH_TOOLS`              | Canonical tool list adapters iterate — discover, pay, agent API keys, receipts, spend limits, etc.     |
| `helpers/*`                | Pure utilities: `probePaymentLink`, `fetchDiscover`, `fetchReputation`, token catalog, address helpers |

## Payment-link tool contract

`leash_create_payment_link` is the shared tool definition used by
`@leashmarket/mcp`, `@leashmarket/cli`, and in-product agent hosts. It supports:

- `method: "GET" | "POST"` — how buyers call the hosted paywall.
- `protocol: "x402" | "mpp"` — which payment rail the hosted paywall speaks.
- `upstream_url` — an existing API endpoint to call after settlement.
- `expected_request_body` — arbitrary JSON metadata describing the POST body
  buyers should send.

`expected_request_body` is not the live request body. The buyer supplies the real
body later through `leash_pay_payment_link` or another x402/MPP client, and the
hosted paywall forwards it to `upstream_url` only after payment settles.
`leash_pay_payment_link` mirrors the same contract with `method` and raw `body`
arguments for POST calls.

## Agent API-key tools

`leash_create_agent_api_key`, `leash_list_agent_api_keys`, and
`leash_revoke_agent_api_key` let a configured agent create and manage its own
Leash API key. These calls are authenticated with `X-Leash-Sig`, so no existing
`LEASH_API_KEY` is required to bootstrap one. Created keys are bound to the
active agent mint, owned by the executive public key, and scoped as exactly
`agent`; plaintext is returned once on create.

## Usage

```ts
import { LEASH_TOOLS, type LeashHost } from '@leashmarket/mcp-core';

// Implement the host contract for your runtime
const host: LeashHost = {
  apiKey: process.env.LEASH_API_KEY!,
  apiUrl: 'https://api.leash.market',
  network: 'solana-mainnet',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  signer: mySigner,
};

// Iterate tools and wire them into your adapter
for (const tool of LEASH_TOOLS) {
  registerTool(tool.name, tool.schema, (args) => tool.handler(host, args));
}
```

### Using helpers directly

```ts
import { probePaymentLink, fetchDiscover } from '@leashmarket/mcp-core/helpers';

// Check if a URL is a valid x402/MPP paywall
const result = await probePaymentLink('https://api.example.com/endpoint');

// Browse the discover catalog
const { items } = await fetchDiscover('https://api.leash.market', {
  capability: 'translate text',
});
```

## Docs

Full tool reference and host contract: [docs.leash.market/sdk/mcp-core](https://docs.leash.market/sdk/mcp-core)

## Develop

```bash
pnpm --filter @leashmarket/mcp-core build
pnpm --filter @leashmarket/mcp-core test
```
