import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leash/seller-kit';
import { createBuyer } from '@leash/buyer-kit';

const port = Number(process.env.PORT ?? 3003);
const rpc = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const asset = process.env.AGENT_ASSET ?? '11111111111111111111111111111111';

const umi = createUmi(rpc).use(mplCore());
const app = new Hono();

createSeller(app, {
  umi,
  sellerAgent: { asset },
  routes: { 'POST /echo': { price: '$0.001', description: 'Echo' } },
});

app.post('/echo', (c) => c.json({ echo: true }));

const buyer = createBuyer({
  agent: asset,
  rules: {
    v: '0.1',
    budget: { daily: '100', perCall: '0.01', currency: 'USDC' },
    hosts: { allow: ['127.0.0.1', 'localhost'] },
    triggers: [{ type: 'interval', seconds: 20 }],
  },
});

setInterval(() => {
  void buyer.fetch(`http://127.0.0.1:${port}/echo`, { method: 'POST' }).then(({ response }) => {
    // eslint-disable-next-line no-console
    console.log('merged buyer', response.status);
  });
}, 20_000);

serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`merged-demo seller+buyer on :${port}`);
