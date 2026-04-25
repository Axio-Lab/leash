# Leash — Copy-paste examples

Every snippet here is the smallest thing that actually works. Pair with
`SKILL.md` (mental model + workflow) and `REFERENCE.md` (full surface).

## 1. Mint an agent (SDK, one tx)

```ts
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createAgent } from '@leash/registry-utils';

const umi = createUmi('https://api.devnet.solana.com').use(mplCore());
umi.use(keypairIdentity(/* ownerKeypair: Keypair */));

const result = await createAgent(umi, {
  wallet: umi.identity.publicKey,
  network: 'solana-devnet',
  name: 'My quoting agent',
  uri: 'ipfs://...metadata.json', // NFT-style metadata pin
  description: 'Returns SOL/USD quotes priced at $0.001 / call',
});
// result = { assetAddress, signature, network }
```

## 1b. Mint an agent (HTTP, polyglot)

```bash
# Step 1 — prepare
curl -sS https://api.leash.market/v1/agents/prepare \
  -H "Authorization: Bearer $LEASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet":"<ownerPubkey>",
    "name":"My quoting agent",
    "uri":"ipfs://...metadata.json",
    "description":"Returns SOL/USD quotes priced at $0.001 / call"
  }'
# → { event_id, transaction: { base64 }, echo: { assetAddress } }

# Step 2 — sign client-side, then submit
curl -sS https://api.leash.market/v1/submit \
  -H "Authorization: Bearer $LEASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "event_id":"<event_id>", "transaction":"<signedBase64>" }'
# → { signature }

# Step 3 — track
curl -sS "https://api.leash.market/v1/events/<event_id>" \
  -H "Authorization: Bearer $LEASH_API_KEY"
# → { phase: "confirmed", signature, ... }
```

## 2. Provision a treasury ATA + delegate spend (SDK)

```ts
import { findAssetSignerPda, prepareSetSpendDelegation } from '@leash/registry-utils';

const [treasury] = findAssetSignerPda(umi, { asset: agentAsset });
// USDC on devnet
const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// Approve up to 10 USDC for the executive keypair to spend.
const tx = await prepareSetSpendDelegation(umi, {
  agentAsset,
  mint: usdcMint,
  delegate: executivePubkey,
  amount: 10_000_000n, // atomic units (USDC has 6 decimals)
});
await tx.sendAndConfirm(umi);
```

## 3. Build a paying buyer (SDK)

```ts
import { createBuyer } from '@leash/buyer-kit';
import { getSpendDelegation } from '@leash/registry-utils';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const signer = await createKeyPairSignerFromBytes(executiveSecretBytes);
const delegation = await getSpendDelegation(umi, { agentAsset, mint: usdcMint });

const buyer = createBuyer({
  agent: agentAsset,
  rules: {
    v: '0.1',
    budget: { daily: '5', perCall: '0.10', currency: 'USDC' },
    hosts: { allow: ['quotes.example.com'] },
    triggers: [],
  },
  signer,
  networks: ['solana-devnet'],
  rpcUrl: 'https://api.devnet.solana.com',
  sourceTokenAccount: delegation.sourceTokenAccount,
  // facilitator: 'http://localhost:8787' // optional override; defaults to hosted
});

const result = await buyer.fetch('https://quotes.example.com/quote');
// result.response, result.receipt.tx_sig, result.receipt.receipt_hash
```

## 4. Monetise an existing API in one call (HTTP, no-code)

```bash
# Create a hosted x402 paywall at /x/{id}
curl -sS https://api.leash.market/v1/payment-links \
  -H "Authorization: Bearer $LEASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "label":"SOL/USD quote",
    "owner_agent":"<sellerAgentAsset>",
    "method":"GET",
    "price":"$0.001",
    "currency":"USDC",
    "response":{
      "status":200,
      "mimeType":"application/json",
      "body":{ "pair":"SOL/USD", "price":142.71 }
    }
  }'
# → { id, url: "https://api.leash.market/x/<id>?network=solana-devnet", accepts:[...] }
```

For a SaaS endpoint you already host, set `response.proxy: { url: 'https://your-api/quote' }` instead of `body` — Leash forwards the call after settlement.

## 5. Mount real x402 on your own Hono app (SDK)

```ts
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leash/seller-kit';

const umi = createUmi(process.env.SOLANA_RPC_URL!).use(mplCore());
const app = new Hono();

createSeller(app, {
  umi,
  sellerAgent: { asset: process.env.LEASH_SELLER_AGENT! },
  routes: {
    'GET /quote': { price: '$0.01', currency: 'USDC' },
  },
  // Receipts forward to the API automatically when both env vars are set:
  //   LEASH_API_URL=https://api.leash.market
  //   LEASH_API_KEY=lsh_live_...
});

app.get('/quote', (c) => c.json({ pair: 'SOL/USD', price: 142.71 }));
```

## 6. Owner withdraw — drain treasury USDC to a wallet (HTTP)

```bash
curl -sS https://api.leash.market/v1/agents/<agentAsset>/treasury/withdraw-all/prepare \
  -H "Authorization: Bearer $LEASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mint":"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "destination":"<destinationOwnerWallet>"
  }'
# → { event_id, transaction.base64 }
# sign with the OWNER keypair (not the executive!), then POST /v1/submit.
```

## 7. Run a local facilitator (devnet)

```bash
# 1. DEDICATED keypair (NEVER reuse buyer / executive keys)
solana-keygen new -o .leash-fee-payer.json --no-bip39-passphrase
solana airdrop 1 -k .leash-fee-payer.json --url https://api.devnet.solana.com

# 2. Boot
export LEASH_FACILITATOR_SECRET_KEY="$(cat .leash-fee-payer.json)"
pnpm --filter @leash/facilitator-app dev
# → listens on http://127.0.0.1:8787

# 3. Point an SDK / API integration at it
export LEASH_API_FACILITATOR_URL=http://localhost:8787
```

Smoke-test it end-to-end:

```bash
LEASH_FACILITATOR_URL=http://localhost:8787 \
  pnpm --filter @leash/api facilitator:smoke
```

## 8. Subscribe to lifecycle events with a webhook

```bash
curl -sS https://api.leash.market/v1/webhooks \
  -H "Authorization: Bearer $LEASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url":"https://yourapp.example.com/leash-hook",
    "kinds":["confirmed","receipt.published","payment_link.settled"]
  }'
# → { id, secret }   (HMAC body with `secret` to verify)
```

## 9. Verify a receipt offline (SDK)

```ts
import { ReceiptV1Schema } from '@leash/schemas';
import { hashReceipt, chainReceipt } from '@leash/core';

const parsed = ReceiptV1Schema.parse(receiptJson);
const recomputed = hashReceipt(parsed); // strips receipt_hash, recomputes
if (recomputed !== parsed.receipt_hash) throw new Error('tampered');
const linksToPrev = chainReceipt(parsed, prevReceipt); // bool
```

## Pointer back to canonical docs

If a snippet here is older than the live docs, the live docs win. Fetch
the page as Markdown directly:

```bash
curl -sS https://docs.leash.market/api/overview.md
curl -sS https://docs.leash.market/sdk/buyer-kit.md
```
