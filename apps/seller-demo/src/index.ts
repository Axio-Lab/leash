import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leash/seller-kit';

const port = Number(process.env.PORT ?? 3001);
const rpc = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const asset = process.env.AGENT_ASSET ?? '11111111111111111111111111111111';

const umi = createUmi(rpc).use(mplCore());
const app = new Hono();

createSeller(app, {
  umi,
  sellerAgent: { asset },
  routes: { 'POST /tag': { price: '$0.001', description: 'Tag a payload' } },
});

app.post('/tag', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({ tagged: true, ...body });
});

serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`seller-demo on :${port}`);
