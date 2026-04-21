import { describe, expect, it } from 'vitest';
import { createBuyer } from '@leash/buyer-kit';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import type { RulesV1 } from '@leash/schemas';

/**
 * Live integration test against a real devnet x402 round-trip.
 *
 * Skipped by default. To enable:
 *
 *   1. Generate a devnet keypair and fund it with devnet SOL + USDC.
 *      See `apps/buyer-demo/README.md` for the faucet links.
 *   2. Stand up a seller (e.g. `pnpm --filter @leash/seller-demo start`)
 *      pointed at a real Core asset mint.
 *   3. Run with the env vars wired:
 *
 *      LEASH_INTEGRATION=1 \
 *      LEASH_BUYER_SECRET_KEY="$(cat ~/.config/solana/leash-buyer.json)" \
 *      LEASH_INTEGRATION_SELLER_URL=http://localhost:3001/tag \
 *      LEASH_INTEGRATION_AGENT=<Core asset mint> \
 *      pnpm --filter @leash/buyer-demo test
 */
const enabled = process.env.LEASH_INTEGRATION === '1';
const sellerUrl = process.env.LEASH_INTEGRATION_SELLER_URL;
const buyerSecret = process.env.LEASH_BUYER_SECRET_KEY;
const agent = process.env.LEASH_INTEGRATION_AGENT;
const rpcUrl = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';

const RULES: RulesV1 = {
  v: '0.1',
  budget: { daily: '1', perCall: '0.01', currency: 'USDC' },
  hosts: { allow: ['localhost', '127.0.0.1', new URL(sellerUrl ?? 'http://x').hostname] },
  triggers: [{ type: 'interval', seconds: 60 }],
};

describe.skipIf(!(enabled && sellerUrl && buyerSecret && agent))(
  'buyer-kit live integration (devnet)',
  () => {
    it('pays a real seller and produces a spend receipt with a tx_sig', async () => {
      const signer = await createKeyPairSignerFromBytes(
        new Uint8Array(JSON.parse(buyerSecret!) as number[]),
      );

      const buyer = createBuyer({
        agent: agent!,
        rules: RULES,
        signer,
        networks: ['solana-devnet'],
        rpcUrl,
      });

      const { response, receipt } = await buyer.fetch(sellerUrl!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ts: Date.now() }),
      });

      expect(response.status).toBe(200);
      expect(receipt.decision).toBe('allow');
      expect(receipt.kind).toBe('spend');
      expect(receipt.tx_sig).toBeTruthy();
      expect(receipt.payment_requirements_hash).toBeTruthy();
    }, 120_000);
  },
);
