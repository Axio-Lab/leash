import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { createSeller } from '@leash/seller-kit';
import { createBuyer } from '@leash/buyer-kit';
import type { ReceiptV1 } from '@leash/schemas';

const port = Number(process.env.PORT ?? 3003);
const rpc = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const asset = process.env.AGENT_ASSET ?? '11111111111111111111111111111111';
const runnerUrl = process.env.RUNNER_URL ?? 'http://localhost:8787';
const buyerSecret = process.env.LEASH_BUYER_SECRET_KEY;

const umi = createUmi(rpc).use(mplCore());
const app = new Hono();

createSeller(app, {
  umi,
  sellerAgent: { asset },
  routes: { 'POST /echo': { price: '$0.001', description: 'Echo' } },
  onReceipt: postReceipt,
});

app.post('/echo', (c) => c.json({ echo: true }));

async function postReceipt(r: ReceiptV1): Promise<void> {
  await fetch(`${runnerUrl}/a/${r.agent}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(r),
  });
}

if (!buyerSecret) {
  // eslint-disable-next-line no-console
  console.log(
    'merged-demo: LEASH_BUYER_SECRET_KEY not set, skipping buyer loop (seller still listening).',
  );
} else {
  const keyBytes = new Uint8Array(JSON.parse(buyerSecret) as number[]);
  const buyerSigner = await createKeyPairSignerFromBytes(keyBytes);

  const buyer = createBuyer({
    agent: asset,
    rules: {
      v: '0.1',
      budget: { daily: '100', perCall: '0.01', currency: 'USDC' },
      hosts: { allow: ['127.0.0.1', 'localhost'] },
      triggers: [{ type: 'interval', seconds: 20 }],
    },
    signer: buyerSigner,
    networks: ['solana-devnet'],
    rpcUrl: rpc,
    onReceipt: postReceipt,
  });

  setInterval(() => {
    void buyer
      .fetch(`http://127.0.0.1:${port}/echo`, { method: 'POST' })
      .then(({ response }) => {
        // eslint-disable-next-line no-console
        console.log('merged buyer', response.status);
      })
      .catch((err: Error) => {
        // eslint-disable-next-line no-console
        console.error('merged buyer error', err.message);
      });
  }, 20_000);
}

serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`merged-demo seller+buyer on :${port}`);
