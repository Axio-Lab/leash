import { createBuyer } from '@leash/buyer-kit';
import { fetchPaymentLinkMeta } from '@leash/core';
import type { ReceiptV1 } from '@leash/schemas';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const sellerUrl = process.env.SELLER_URL ?? 'http://localhost:3001';
const runnerUrl = process.env.RUNNER_URL ?? 'http://localhost:8787';
const rpcUrl = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const agent = process.env.AGENT_ASSET ?? '11111111111111111111111111111111';
const intervalMs = Number(process.env.POLL_MS ?? 30_000);
const buyerSecret = process.env.LEASH_BUYER_SECRET_KEY;
/**
 * Optional: the agent's USDC ATA (owned by the agent's Asset Signer PDA).
 *
 * When set, the buyer signs transfers as the SPL **delegate** of this account
 * and funds debit from the agent treasury — matching the playground's
 * "agent funds itself" model. Set up the delegation once with
 * `setSpendDelegation` from `@leash/registry-utils` (the web app does this
 * automatically at agent creation time).
 *
 * When unset, the buyer-kit falls back to spending from the signer wallet's
 * own USDC ATA — useful for headless smoke tests where you haven't minted a
 * Core agent yet.
 */
const sourceTokenAccount = process.env.LEASH_BUYER_SOURCE_TOKEN_ACCOUNT;
const isLeashPaymentLink = /\/x\/[^/]+$/i.test(sellerUrl);

if (!buyerSecret) {
  // eslint-disable-next-line no-console
  console.error(
    'buyer-demo: set LEASH_BUYER_SECRET_KEY to a JSON byte array of a devnet keypair (see README).',
  );
  process.exit(1);
}

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

const keyBytes = new Uint8Array(JSON.parse(buyerSecret) as number[]);
const buyerSigner = await createKeyPairSignerFromBytes(keyBytes);

const buyer = createBuyer({
  agent,
  rules,
  signer: buyerSigner,
  networks: ['solana-devnet'],
  rpcUrl,
  onReceipt: postReceipt,
  ...(sourceTokenAccount ? { sourceTokenAccount } : {}),
});

let requestUrl = isLeashPaymentLink ? sellerUrl : `${sellerUrl}/tag`;
let requestMethod: 'GET' | 'POST' = 'POST';
if (isLeashPaymentLink) {
  try {
    const meta = await fetchPaymentLinkMeta(sellerUrl);
    requestUrl = meta.endpoint.url;
    requestMethod = meta.endpoint.method;
    // eslint-disable-next-line no-console
    console.log(
      `buyer-demo discovered payment link ${meta.endpoint.id} (${meta.endpoint.method} ${meta.endpoint.price} on ${meta.endpoint.network})`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`buyer-demo discovery failed for ${sellerUrl}; continuing anyway`, err);
  }
}

async function tick(): Promise<void> {
  const init: RequestInit =
    requestMethod === 'POST'
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ts: Date.now() }),
        }
      : { method: 'GET' };
  const { response, receipt } = await buyer.fetch(requestUrl, init);
  // eslint-disable-next-line no-console
  console.log('buyer tick', response.status, receipt.decision, receipt.receipt_hash.slice(0, 8));
}

void tick();
setInterval(() => {
  void tick();
}, intervalMs);
