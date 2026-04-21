import { createBuyer } from '@leash/buyer-kit';
import type { ReceiptV1 } from '@leash/schemas';

const sellerUrl = process.env.SELLER_URL ?? 'http://localhost:3001';
const runnerUrl = process.env.RUNNER_URL ?? 'http://localhost:8787';
const agent = process.env.AGENT_ASSET ?? '11111111111111111111111111111111';
const intervalMs = Number(process.env.POLL_MS ?? 30_000);

const rules = {
  v: '0.1' as const,
  budget: { daily: '100', perCall: '0.01', currency: 'USDC' as const },
  hosts: {
    allow: ['localhost', '127.0.0.1', 'seller-demo', 'host.docker.internal'],
  },
  triggers: [{ type: 'interval' as const, seconds: intervalMs / 1000 }],
};

async function postReceipt(r: ReceiptV1): Promise<void> {
  await fetch(`${runnerUrl}/a/${r.agent}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(r),
  });
}

const buyer = createBuyer({ agent, rules, onReceipt: postReceipt });

async function tick(): Promise<void> {
  const { response, receipt } = await buyer.fetch(`${sellerUrl}/tag`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ts: Date.now() }),
  });
  // eslint-disable-next-line no-console
  console.log('buyer tick', response.status, receipt.decision, receipt.receipt_hash.slice(0, 8));
}

void tick();
setInterval(() => {
  void tick();
}, intervalMs);
