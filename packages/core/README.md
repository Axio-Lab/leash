# @leashmarket/core

Policy evaluation, receipt hashing / chain verification, real x402 client
adapter for Solana, treasury helpers, and an env-based kill-switch.

## Install

```bash
npm install @leashmarket/core
# or
pnpm add @leashmarket/core
```

## Usage

```ts
import {
  evaluate,
  finalizeReceipt,
  verifyReceiptChain,
  treasuryPda,
  readPauseFromEnv,
} from '@leashmarket/core';
import { createSvmBuyerFetch } from '@leashmarket/core/x402';
```

`createSvmBuyerFetch({ signer, networks, rpcUrl })` registers
`ExactSvmScheme` (from `@x402/svm`) with `wrapFetchWithPayment` (from
`@x402/fetch`) and returns a `paidFetch` that handles the real x402
402 → sign SPL transfer → retry → settle round-trip on Solana.

All hashing uses `@noble/hashes` so the package runs unchanged in Node,
the browser, and edge runtimes.

## Docs

[docs.leash.market/sdk/core](https://docs.leash.market/sdk/core)

See also: [Real x402 on Solana](https://docs.leash.market/standards/x402-on-solana)

## Test

```bash
pnpm --filter @leashmarket/core test
```
