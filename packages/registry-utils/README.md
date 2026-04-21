# @leash/registry-utils

Pinata JSON upload, BYO URI resolution, gateway CID smoke-check, leash block helpers, and registration helpers.

```ts
import { resolveOrUpload } from '@leash/registry-utils';
```

Set `PINATA_JWT` for uploads. Devnet-gated tests: `RUN_DEVNET=1 pnpm --filter @leash/registry-utils test:devnet`.
