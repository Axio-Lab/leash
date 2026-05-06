# @leashmarket/seller-kit

## Install

```bash
npm install @leashmarket/seller-kit
# or
pnpm add @leashmarket/seller-kit
```

---

Hono integration for Leash sellers. Three responsibilities:

1. **Real x402 middleware on Solana.** `createSeller` mounts
   `paymentMiddlewareFromHTTPServer` from `@x402/hono`, configured via
   `createSvmResourceServer` (which wraps `ExactSvmScheme` from
   `@x402/svm`) and pointed at an HTTPS facilitator (default
   `https://facilitator.svmacc.tech`). Unauthenticated traffic gets
   `402 + PAYMENT-REQUIRED`; settled traffic invokes the real handler.
2. **Asset Signer PDA `payTo`.** The middleware always credits the seller
   agent's Asset Signer PDA (derived via `mpl-core`), so funds land in the
   on-chain treasury without the seller agent needing a private key.
3. **`earn` receipts.** Every settled call emits a tamper-evident
   `ReceiptV1` (with the real `tx_sig` and
   `payment_requirements_hash` from the facilitator's
   `PAYMENT-RESPONSE`) to the user-supplied `onReceipt` callback. Receipts
   are nonce-ordered and hash-chained per seller agent, mirroring
   `@leashmarket/buyer-kit` so explorers can verify both sides of the trade.

```ts
import { createSeller } from '@leashmarket/seller-kit';

createSeller(app, {
  umi,
  sellerAgent: { asset: assetMint },
  routes: { 'POST /tag': { price: '$0.001', description: 'tag' } },
  onReceipt: (r) =>
    fetch(`${RUNNER}/a/${r.agent}/receipts`, {
      method: 'POST',
      body: JSON.stringify(r),
    }),
});
```

## Receipt semantics

- **402 → no receipt.** No settled trade to record.
- **2xx after settle → one earn receipt** with `tx_sig` and
  `payment_requirements_hash` lifted from `PAYMENT-RESPONSE`.
- **Handler 4xx/5xx after payment → no receipt.** Recording would lie
  about a settled trade.
- **Chain.** `prev_receipt_hash` links to the previous receipt's
  `receipt_hash` for the same seller agent (in-process state).

## Price parsing

`SellerRouteConfig.price` is a human display string. Use `parsePrice()` to
inspect what lands on a receipt:

```ts
parsePrice('$0.001'); // { amount: '0.001', currency: 'USDC' }
parsePrice('0.5 USDT'); // { amount: '0.5',   currency: 'USDT' }
parsePrice('0.01'); // { amount: '0.01',  currency: 'USDC' }
```

`$` and `USD` normalise to `USDC` since SVM settlement uses USDC.

## Configuring the facilitator

```ts
import { createSvmResourceServer } from '@leashmarket/seller-kit/x402';

const server = createSvmResourceServer({
  network: 'solana-devnet',
  payTo,
  asset: '<USDC mint>',
  facilitatorUrl: 'https://your-facilitator.example.com',
});
```

## Docs

[docs.leash.market/sdk/seller-kit](https://docs.leash.market/sdk/seller-kit)

See also: [Real x402 on Solana](https://docs.leash.market/standards/x402-on-solana)
