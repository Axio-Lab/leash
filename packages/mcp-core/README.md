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
| `LEASH_TOOLS`              | Canonical tool list adapters iterate — discover, pay, receipts, spend limits, etc.                     |
| `helpers/*`                | Pure utilities: `probePaymentLink`, `fetchDiscover`, `fetchReputation`, token catalog, address helpers |

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

// Check if a URL is a valid x402 paywall
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
