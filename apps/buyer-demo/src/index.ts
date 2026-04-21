import { createBuyer } from '@leash/buyer-kit';

const sellerUrl = process.env.SELLER_URL ?? 'http://localhost:3001';
const agent = process.env.AGENT_ASSET ?? 'BuyerDemoAgent1111111111111111111111';
const intervalMs = Number(process.env.POLL_MS ?? 30_000);

const rules = {
  v: '0.1' as const,
  budget: { daily: '100', perCall: '0.01', currency: 'USDC' as const },
  hosts: {
    allow: ['localhost', '127.0.0.1', 'seller-demo', 'host.docker.internal'],
  },
  triggers: [{ type: 'interval' as const, seconds: intervalMs / 1000 }],
};

const buyer = createBuyer({ agent, rules });

async function tick(): Promise<void> {
  const { response } = await buyer.fetch(`${sellerUrl}/tag`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ts: Date.now() }),
  });
  // eslint-disable-next-line no-console
  console.log('buyer tick', response.status);
}

void tick();
setInterval(() => {
  void tick();
}, intervalMs);
