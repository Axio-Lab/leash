# @leash/seller-kit

Hono integration: **x402-shaped gate** (`simpleX402Gate`) + **`createSeller`** wiring routes to the seller agent’s **Asset Signer PDA** pay-to address (via mpl-core).

```ts
import { createSeller } from '@leash/seller-kit';
```

v0.1 does **not** bundle `@x402/solana` (npm availability); the gate is intentionally minimal for demos.
