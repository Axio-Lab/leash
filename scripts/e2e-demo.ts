/**
 * Scripted “5-minute demo” outline — extend with real mint + x402 when keys are present.
 *
 *   SELLER_URL=http://localhost:3001 pnpm exec tsx scripts/e2e-demo.ts
 */
import { createBuyer } from '@leash/buyer-kit';

const seller = process.env.SELLER_URL ?? 'http://localhost:3001';
const agent = process.env.AGENT_ASSET ?? '11111111111111111111111111111111';

async function main(): Promise<void> {
  const buyer = createBuyer({
    agent,
    rules: {
      v: '0.1',
      budget: { daily: '100', perCall: '1', currency: 'USDC' },
      hosts: { allow: ['127.0.0.1', 'localhost'] },
      triggers: [{ type: 'interval', seconds: 60 }],
    },
  });
  const { response, receipt } = await buyer.fetch(`${seller}/tag`, { method: 'POST' });
  console.log('status', response.status);
  console.log('receipt', receipt ? JSON.stringify(receipt, null, 2) : null);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
