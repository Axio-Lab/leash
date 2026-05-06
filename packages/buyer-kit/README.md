# @leashmarket/buyer-kit

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
  onReceipt: (r) =>
    fetch(`${RUNNER}/a/${r.agent}/receipts`, {
      method: 'POST',
      body: JSON.stringify(r),
    }),
});

const { response, receipt } = await buyer.fetch(url, init);
```

On a `402 Payment Required`, the wrapped `paidFetch` (`@x402/fetch` +
`ExactSvmScheme`) builds an SPL transfer matching the seller's
`accepts[]`, signs it with your `signer`, and replays the request with
`PAYMENT-SIGNATURE`. The resulting `tx_sig` and
`payment_requirements_hash` end up on the receipt.

See the [`Real x402 on Solana`](../../apps/docs/standards/x402-on-solana.mdx)
doc for the protocol-level walkthrough.
