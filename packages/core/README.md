# @leash/core

Policy evaluation, receipt hashing / chain verification, real x402 client
adapter for Solana, treasury helpers, and an env-based kill-switch.

```ts
import {
  evaluate,
  finalizeReceipt,
  verifyReceiptChain,
  treasuryPda,
  readPauseFromEnv,
} from '@leash/core';
import { createSvmBuyerFetch } from '@leash/core/x402';
```

`createSvmBuyerFetch({ signer, networks, rpcUrl })` registers
`ExactSvmScheme` (from `@x402/svm`) with `wrapFetchWithPayment` (from
`@x402/fetch`) and returns a `paidFetch` that handles the real x402
402 → sign SPL transfer → retry → settle round-trip on Solana.

All hashing uses `@noble/hashes` so the package runs unchanged in Node,
the browser, and edge runtimes.

## Test

```bash
pnpm --filter @leash/core test
```

See the [`Real x402 on Solana`](../../apps/docs/standards/x402-on-solana.mdx)
doc for the protocol-level walkthrough.
