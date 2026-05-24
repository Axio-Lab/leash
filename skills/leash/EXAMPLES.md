# Leash — Copy-paste examples

Every snippet here is the smallest thing that actually works. Pair with
`SKILL.md` (mental model + workflow) and `REFERENCE.md` (full surface).

## 1. Mint an agent (SDK, one tx)

```ts
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createAgent } from '@leashmarket/registry-utils';

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

# Step 2 — sign client-side, then submit via the API (NOT raw RPC).
# POST /v1/submit is what writes the event row, watchlists the agent,
# and makes the mint visible on explorer.leash.market.
curl -sS https://api.leash.market/v1/submit \
  -H "Authorization: Bearer $LEASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "event_id":"<event_id>", "transaction":"<signedBase64>" }'
# → { signature }

# Step 3 — track (poll until phase=confirmed)
curl -sS "https://api.leash.market/v1/events/<event_id>" \
  -H "Authorization: Bearer $LEASH_API_KEY"
# → { phase: "confirmed", signature, ... }
```

## 2. Provision a treasury ATA + delegate spend (SDK)

```ts
import { findAssetSignerPda, prepareSetSpendDelegation } from '@leashmarket/registry-utils';
import { tokenProgramForMint, TOKEN_2022_PROGRAM_ID } from '@leashmarket/core';

const [treasury] = findAssetSignerPda(umi, { asset: agentAsset });

// USDC (legacy SPL Token) on devnet.
const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const usdcTx = await prepareSetSpendDelegation(umi, {
  agentAsset,
  mint: usdcMint,
  delegate: executivePubkey,
  amount: 10_000_000n, // 10 USDC, 6 decimals
});
await usdcTx.sendAndConfirm(umi);

// USDG (SPL Token-2022) on devnet — pass the token program explicitly so the
// helper writes the Approve under the right program and the buyer-kit's
// pre-flight (which uses `tokenProgramForMint` internally) finds the matching
// ATA. Without this you'd silently approve a legacy-program ATA that doesn't
// exist and the next pay would fail with `ata_missing`.
const usdgMint = '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7';
const usdgProgram =
  tokenProgramForMint(usdgMint) === 'spl-token-2022' ? TOKEN_2022_PROGRAM_ID : undefined;
const usdgTx = await prepareSetSpendDelegation(umi, {
  agentAsset,
  mint: usdgMint,
  delegate: executivePubkey,
  amount: 10_000_000n, // 10 USDG, 6 decimals
  ...(usdgProgram ? { tokenProgram: usdgProgram } : {}),
});
await usdgTx.sendAndConfirm(umi);
```

## 3. Build a paying buyer (SDK)

```ts
import { createBuyer } from '@leashmarket/buyer-kit';
import { getSpendDelegation } from '@leashmarket/registry-utils';
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
# Create a hosted x402 paywall at /x/{id} that forwards to an existing API
curl -sS https://api.leash.market/v1/payment-links \
  -H "Authorization: Bearer $LEASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "label":"JSONPlaceholder posts",
    "owner_agent":"<sellerAgentAsset>",
    "method":"GET",
    "price":"$0.001",
    "currency":"USDC",
    "response":{
      "status":200,
      "mimeType":"application/json",
      "body":{
        "ok":true,
        "message":"Payment accepted. Call the protected endpoint to receive live data."
      }
    },
    "metadata":{
      "upstream_url":"https://jsonplaceholder.typicode.com/posts",
      "provider_url":"https://jsonplaceholder.typicode.com",
      "pricing_type":"fixed"
    }
  }'
# → { id, url: "https://api.leash.market/x/<id>?network=solana-devnet", accepts:[...] }
```

Runtime behavior: the unpaid call returns `402`; the buyer-kit paid retry settles on Solana, Leash forwards to `metadata.upstream_url`, and the buyer receives the live upstream response. Without `metadata.upstream_url`, Leash returns the configured `response.body` template.

The same flow from CLI:

```bash
leash sell create-link \
  --label "JSONPlaceholder posts" \
  --amount 0.001 \
  --currency USDC \
  --method GET \
  --upstream-url https://jsonplaceholder.typicode.com/posts
```

## 5. Mount real x402 on your own Hono app (SDK)

```ts
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leashmarket/seller-kit';

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
# Step 1 — prepare
curl -sS https://api.leash.market/v1/agents/<agentAsset>/treasury/withdraw-all/prepare \
  -H "Authorization: Bearer $LEASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mint":"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "destination":"<destinationOwnerWallet>"
  }'
# → { event_id, transaction.base64 }

# Step 2 — sign with the OWNER keypair (not the executive!), then submit
# via POST /v1/submit — NOT via raw sendRawTransaction. The submit step
# is what creates the event row and ensures the withdrawal appears on the
# explorer and in the receipt feed.
curl -sS https://api.leash.market/v1/submit \
  -H "Authorization: Bearer $LEASH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "event_id":"<event_id>", "transaction":"<signedBase64>" }'
# → { signature }
```

## 7. Run a local facilitator (devnet)

```bash
# 1. DEDICATED keypair (NEVER reuse buyer / executive keys)
solana-keygen new -o .leash-fee-payer.json --no-bip39-passphrase
solana airdrop 1 -k .leash-fee-payer.json --url https://api.devnet.solana.com

# 2. Boot
export LEASH_FACILITATOR_SECRET_KEY="$(cat .leash-fee-payer.json)"
pnpm --filter @leashmarket/facilitator-app dev
# → listens on http://127.0.0.1:8787

# 3. Point an SDK / API integration at it
export LEASH_API_FACILITATOR_URL=http://localhost:8787
```

Smoke-test it end-to-end:

```bash
LEASH_FACILITATOR_URL=http://localhost:8787 \
  pnpm --filter @leashmarket/api facilitator:smoke
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
import { ReceiptV1Schema } from '@leashmarket/schemas';
import { hashReceipt, chainReceipt } from '@leashmarket/core';

const parsed = ReceiptV1Schema.parse(receiptJson);
const recomputed = hashReceipt(parsed); // strips receipt_hash, recomputes
if (recomputed !== parsed.receipt_hash) throw new Error('tampered');
const linksToPrev = chainReceipt(parsed, prevReceipt); // bool
```

## 10. Discover and pay an external API (pay-skills)

The `/v1/discover` feed merges Leash marketplace listings with the Solana
Foundation [`pay-skills`](https://github.com/solana-foundation/pay-skills)
registry. Each row carries `source: "leash" | "pay-skills"`. For pay-skills
items, `slug` is the provider FQN (e.g. `agentmail/email`); use it to expand
the provider into its individual paid endpoints.

```ts
import { LeashClient } from '@leashmarket/sdk';

const leash = new LeashClient({ baseUrl: 'https://api.leash.market' });

// 1. Search by capability — public, no auth.
const search = await leash.discover({ capability: 'email', source: 'pay-skills', limit: 5 });

// 2. Pick a provider and expand it.
const item = search.items[0]!; // source === 'pay-skills'
const provider = await leash.paySkillsProvider(item.slug);

// 3. Pick the right endpoint and pay it with @leashmarket/buyer-kit (omitted).
const ep = provider.endpoints.find((e) => e.probe_status === 'ok' && e.protocol?.includes('x402'));
console.log(`${ep!.method} ${ep!.url} — accepts ${(ep!.supported_usd ?? []).join(', ')}`);
```

CLI equivalent:

```bash
leash discover -q email --source pay-skills --limit 5
leash discover endpoints agentmail/email
leash pay https://x402.api.agentmail.to/v0/inboxes
```

## Pointer back to canonical docs

If a snippet here is older than the live docs, the live docs win. Fetch
the page as Markdown directly:

```bash
curl -sS https://docs.leash.market/api/overview.md
curl -sS https://docs.leash.market/sdk/buyer-kit.md
```
