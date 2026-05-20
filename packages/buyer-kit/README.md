# @leashmarket/buyer-kit

## Install

```bash
npm install @leashmarket/buyer-kit
# or
pnpm add @leashmarket/buyer-kit
```

---

`createBuyer` — policy gate from `@leashmarket/schemas`, real x402 SPL-USDC
settlement on Solana via `@leashmarket/core`, chained `ReceiptV1` per call.

```ts
import { createBuyer } from '@leashmarket/buyer-kit';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const signer = await createKeyPairSignerFromBytes(secretKeyBytes);

const buyer = createBuyer({
  agent: '<Core asset mint>',
  rules: {
    v: '0.1',
    budget: { daily: '10', perCall: '0.01', currency: 'USDC' },
    hosts: { allow: ['api.example.com'] },
    triggers: [{ type: 'interval', seconds: 30 }],
  },
  signer, // @solana/kit TransactionPartialSigner
  networks: ['solana-devnet'],
  rpcUrl: 'https://api.devnet.solana.com',
  identity: {
    selector: { handle: 'seller-agent' },
    capability: { slug: 'seller/tag-api', protocol: 'x402' },
    thresholds: { require_verified_domain: true },
  },
  onReceipt: (r) =>
    fetch(`${RUNNER}/a/${r.agent}/receipts`, {
      method: 'POST',
      body: JSON.stringify(r),
    }),
});

const { response, receipt } = await buyer.fetch(url, init);
```

When `identity` is set, buyer-kit calls Leash's trust-verdict verifier before
payment. A `deny` verdict blocks the request and emits a denied spend receipt;
`warn` is allowed unless `blockOnWarn: true` is set.

On a `402 Payment Required`, the wrapped `paidFetch` (`@x402/fetch` +
`ExactSvmScheme`) builds an SPL transfer matching the seller's
`accepts[]`, signs it with your `signer`, and replays the request with
`PAYMENT-SIGNATURE`. The resulting `tx_sig` and
`payment_requirements_hash` end up on the receipt.

## Docs

[docs.leash.market/sdk/buyer-kit](https://docs.leash.market/sdk/buyer-kit)

See also: [Real x402 on Solana](https://docs.leash.market/standards/x402-on-solana)
