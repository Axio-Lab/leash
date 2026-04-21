# @leash/seller-kit

Hono integration for Leash sellers. Three responsibilities:

1. **x402-shaped gate** (`simpleX402Gate`) — returns `402` unless the
   request carries an `x-payment` header. Production should swap this for
   `@x402/hono`'s `paymentMiddleware` + a real facilitator (PayAI / Corbits).
2. **`createSeller(app, opts)`** — wires the gate onto the configured
   `routes` and exposes the seller agent's **Asset Signer PDA** as `payTo`
   (via `mpl-core`).
3. **`earn` receipts** — every settled call (status 2xx/3xx after the
   gate forwards) emits a tamper-evident `ReceiptV1` to the user-supplied
   `onReceipt` callback. Receipts are nonce-ordered and hash-chained per
   seller agent, mirroring `@leash/buyer-kit` so explorers can verify
   both sides of the trade.

```ts
import { createSeller } from '@leash/seller-kit';

createSeller(app, {
  umi,
  sellerAgent: { asset: assetMint },
  routes: { 'POST /tag': { price: '$0.001', description: 'tag' } },
  // Ship every earn receipt to the runner. Errors are swallowed so a
  // runner outage never breaks a paying customer's request.
  onReceipt: (r) =>
    fetch(`${RUNNER}/a/${r.agent}/receipts`, {
      method: 'POST',
      body: JSON.stringify(r),
    }),
});
```

## Receipt semantics

- **402 → no receipt.** No settled trade to record.
- **2xx/3xx → one earn receipt.** Includes `request.body_hash`,
  `response.status`, and `tx_sig` (forwarded from the request's `x-tx-sig`
  header — set this from your facilitator).
- **4xx/5xx after the gate → no receipt.** The handler failed after
  payment was attached; recording it would lie about a settled trade.
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

v0.1 normalises `$` and `USD` to `USDC` since SVM settlement uses USDC.

## Status

v0.1 does **not** bundle `@x402/solana` (npm availability); the gate is
intentionally minimal for demos. Production wiring lives behind a
`paymentMiddleware` swap — the receipt layer is unchanged either way.
