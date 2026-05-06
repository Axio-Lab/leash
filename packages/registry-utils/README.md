# @leashmarket/registry-utils

Registration URI resolution (`resolveByoUri`), leash block helpers, and Metaplex agent / treasury helpers for creating and managing on-chain Leash agents.

## Install

```bash
npm install @leashmarket/registry-utils
# or
pnpm add @leashmarket/registry-utils
```

## Usage

```ts
import { resolveByoUri, mintAgentAsset, treasuryPda } from '@leashmarket/registry-utils';

// Resolve a bring-your-own registration URI
const registration = await resolveByoUri('https://example.com/leash.json');

// Derive the treasury PDA for an agent
const treasury = treasuryPda(agentMint, usdcMint, network);
```

## Docs

[docs.leash.market/sdk/registry-utils](https://docs.leash.market/sdk/registry-utils)

## Test

```bash
# Unit tests
pnpm --filter @leashmarket/registry-utils test

# Devnet-gated integration tests
RUN_DEVNET=1 pnpm --filter @leashmarket/registry-utils test:devnet
```
