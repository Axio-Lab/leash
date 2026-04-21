import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { createSeller } from '@leash/seller-kit';
import type { ReceiptV1 } from '@leash/schemas';

const port = Number(process.env.PORT ?? 3001);
const rpc = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const asset = process.env.AGENT_ASSET ?? '11111111111111111111111111111111';
const runnerUrl = process.env.RUNNER_URL ?? 'http://localhost:8787';

const umi = createUmi(rpc).use(mplCore());
const app = new Hono();

async function postReceipt(r: ReceiptV1): Promise<void> {
  await fetch(`${runnerUrl}/a/${r.agent}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(r),
  });
}

createSeller(app, {
  umi,
  sellerAgent: { asset },
  routes: { 'POST /tag': { price: '$0.001', description: 'Tag a payload' } },
  onReceipt: postReceipt,
});

app.post('/tag', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({ tagged: true, ...body });
});

serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`seller-demo on :${port}`);
