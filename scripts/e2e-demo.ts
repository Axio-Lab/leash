/**
 * Scripted "5-minute demo": fires a single real x402 SPL-USDC payment from a
 * devnet keypair against a seller. The seller settles via
 * `https://facilitator.svmacc.tech` and we print the resulting receipt.
 *
 *   LEASH_BUYER_SECRET_KEY='[1,2,3,…,64]' \\
 *   SELLER_URL=http://localhost:3001 \\
 *   pnpm exec tsx scripts/e2e-demo.ts
 */
import { createBuyer } from '@leash/buyer-kit';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const seller = process.env.SELLER_URL ?? 'http://localhost:3001';
const rpcUrl = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const agent = process.env.AGENT_ASSET ?? '11111111111111111111111111111111';
const secret = process.env.LEASH_BUYER_SECRET_KEY;

async function main(): Promise<void> {
  if (!secret) {
    throw new Error('Set LEASH_BUYER_SECRET_KEY (JSON array of 64 keypair bytes).');
  }
  const keyBytes = new Uint8Array(JSON.parse(secret) as number[]);
  const signer = await createKeyPairSignerFromBytes(keyBytes);

  const buyer = createBuyer({
    agent,
    rules: {
      v: '0.1',
      budget: { daily: '100', perCall: '1', currency: 'USDC' },
      hosts: { allow: ['127.0.0.1', 'localhost'] },
      triggers: [{ type: 'interval', seconds: 60 }],
    },
    signer,
    networks: ['solana-devnet'],
    rpcUrl,
  });

  const { response, receipt } = await buyer.fetch(`${seller}/tag`, { method: 'POST' });
  console.log('status', response.status);
  console.log('receipt', receipt ? JSON.stringify(receipt, null, 2) : null);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
