/**
 * SDK-level smoke test for a local Leash facilitator.
 *
 * What this proves
 * ----------------
 * `@leash/seller-kit` (the merchant) and `@leash/buyer-kit` (the agent
 * paying with USDC) can complete a real x402 settlement on devnet when
 * BOTH are pointed at a locally-running facilitator (default
 * `http://localhost:8787`). It bypasses the @leash/api HTTP surface
 * entirely so a green run isolates the facilitator + SDK pair from any
 * API regressions.
 *
 * Steps
 * -----
 *   1. Spin up a one-route Hono server in-process via `createSeller`,
 *      pointed at $LEASH_FACILITATOR_URL.
 *   2. Build a buyer (`createBuyer`) using the same facilitator URL,
 *      with the e2e owner key signing as the SPL spend delegate of the
 *      buyer agent's USDC ATA.
 *   3. `buyer.fetch(seller_url)` — the seller returns 402 with
 *      `payment-required`, the buyer signs a `TransferChecked`, the
 *      facilitator settles, and the seller returns 200 with
 *      `PAYMENT-RESPONSE`.
 *   4. Assert: 200 status, non-empty `tx_sig`, `receipt_hash`,
 *      `price.amount`, and that the `facilitator` stamped on the
 *      receipt matches the local URL.
 *
 * Required env (reused from .env.e2e)
 * -----------------------------------
 *   LEASH_E2E_OWNER_SECRET    Same key the local facilitator was
 *                             started with. Acts as the buyer's spend
 *                             delegate.
 *   LEASH_E2E_SELLER_AGENT    Existing seller agent asset.
 *   LEASH_E2E_BUYER_AGENT     Existing buyer agent asset (its USDC
 *                             treasury ATA must already be funded +
 *                             have a spend delegation to the owner —
 *                             `e2e:devnet` does this for you on the
 *                             very first run).
 *
 * Optional env
 * ------------
 *   LEASH_FACILITATOR_URL     Default: http://localhost:8787
 *   LEASH_E2E_RPC             Default: https://api.devnet.solana.com
 *   LEASH_E2E_USDC_MINT       Default: Circle's devnet USDC.
 *   LEASH_E2E_PRICE           Default: $0.001
 *
 * Usage
 * -----
 *   cd apps/api && node --env-file=.env.e2e --import tsx ./scripts/facilitator-sdk-smoke.ts
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';

import { createBuyer } from '@leash/buyer-kit';
import { createSeller } from '@leash/seller-kit';
import { getSpendDelegation } from '@leash/registry-utils';

const FACILITATOR_URL = (process.env.LEASH_FACILITATOR_URL ?? 'http://localhost:8787').replace(
  /\/+$/,
  '',
);
const RPC = process.env.LEASH_E2E_RPC ?? 'https://api.devnet.solana.com';
const USDC_MINT = process.env.LEASH_E2E_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PRICE = process.env.LEASH_E2E_PRICE ?? '$0.001';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) fatal(`missing env ${name} (load apps/api/.env.e2e)`);
  return v;
}
function fatal(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}
function info(msg: string): void {
  console.log(`  · ${msg}`);
}
function step(title: string): void {
  console.log(`\n──── ${title} ────`);
}
function decodeSecret(raw: string): Uint8Array {
  const t = raw.trim();
  if (t.startsWith('[')) return Uint8Array.from(JSON.parse(t) as number[]);
  return base58.serialize(t);
}

async function probeFacilitator(): Promise<void> {
  const res = await fetch(`${FACILITATOR_URL}/health`).catch((e: unknown) => {
    fatal(
      `cannot reach facilitator at ${FACILITATOR_URL}: ${(e as Error).message}\n` +
        `  start it with: cd apps/facilitator && pnpm dev`,
    );
  });
  if (!res || !res.ok) {
    fatal(`facilitator /health returned ${res?.status ?? 'no response'}`);
  }
  const body = (await res.json()) as { ok?: boolean; signers?: string[] };
  ok(`facilitator alive at ${FACILITATOR_URL} (signers: ${(body.signers ?? []).join(', ')})`);
}

async function main(): Promise<void> {
  console.log('============================================================');
  console.log('Leash facilitator SDK smoke test');
  console.log('============================================================');
  console.log(`facilitator: ${FACILITATOR_URL}`);
  console.log(`rpc        : ${RPC}`);
  console.log(`usdc mint  : ${USDC_MINT}`);
  console.log(`price      : ${PRICE}`);

  step('Probe local facilitator');
  await probeFacilitator();

  step('Resolve agents + signer');
  const ownerSecret = decodeSecret(required('LEASH_E2E_OWNER_SECRET'));
  const ownerSigner = await createKeyPairSignerFromBytes(ownerSecret);
  const ownerPubkey = String(ownerSigner.address);
  const buyerAgent = required('LEASH_E2E_BUYER_AGENT');
  const sellerAgent = required('LEASH_E2E_SELLER_AGENT');
  const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(ownerSecret)));
  ok(`owner    : ${ownerPubkey}`);
  ok(`seller   : ${sellerAgent}`);
  ok(`buyer    : ${buyerAgent}`);

  step('Confirm buyer treasury USDC delegation to owner');
  const delegation = await getSpendDelegation(umi, { agentAsset: buyerAgent, mint: USDC_MINT });
  if (delegation.delegate !== ownerPubkey || delegation.delegatedAmount === 0n) {
    fatal(
      `buyer USDC ATA not delegated to owner — delegate=${delegation.delegate}, ` +
        `amount=${delegation.delegatedAmount.toString()}.\n` +
        '  run apps/api/scripts/e2e-devnet.ts once to set this up.',
    );
  }
  if (delegation.balance === 0n) {
    fatal(
      `buyer USDC ATA empty (${delegation.sourceTokenAccount}). ` +
        'top it up with apps/api/scripts/fund.ts or e2e-devnet.ts.',
    );
  }
  info(`source ATA   : ${delegation.sourceTokenAccount}`);
  info(`balance      : ${delegation.balance.toString()} atomic`);
  info(`allowance    : ${delegation.delegatedAmount.toString()} atomic`);

  step('Spin up a tiny seller-kit Hono server (random port, local facilitator)');
  const app = new Hono();
  const seller = createSeller(app, {
    umi,
    sellerAgent: { asset: sellerAgent },
    network: 'solana-devnet',
    facilitator: FACILITATOR_URL,
    onReceipt: false, // smoke test only — no fan-out to runner/api
    routes: {
      'GET /quote': {
        description: 'Static SOL/USD quote (smoke test)',
        price: PRICE,
        currency: 'USDC',
      },
    },
  });
  app.get('/quote', (c) => c.json({ pair: 'SOL/USD', price: 142.71, ts: Date.now() }));

  // Bind to ephemeral port.
  const baseServer = createServer();
  await new Promise<void>((resolve) => baseServer.listen(0, '127.0.0.1', resolve));
  const port = (baseServer.address() as AddressInfo).port;
  baseServer.close();
  const handle = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  // Give Node a microtask to actually listen.
  await sleep(100);
  const sellerUrl = `http://127.0.0.1:${port}`;
  ok(`seller listening on ${sellerUrl}`);
  info(`seller payTo : ${seller.payTo}`);
  info(`seller facil : ${seller.facilitatorUrl}`);

  try {
    step('Anonymous probe — must return 402 with payment-required');
    const probe = await fetch(`${sellerUrl}/quote`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (probe.status !== 402) {
      fatal(`seller did not return 402 — got ${probe.status}`);
    }
    const probeReq = probe.headers.get('payment-required') ?? probe.headers.get('PAYMENT-REQUIRED');
    if (!probeReq || probeReq.length === 0) {
      fatal('seller returned 402 but no payment-required header');
    }
    ok(`402 + payment-required (${probeReq.length} bytes)`);

    step('createBuyer.fetch — real settlement via local facilitator');
    const buyer = createBuyer({
      agent: buyerAgent,
      rules: {
        v: '0.1',
        budget: { daily: '10', perCall: '0.01', currency: 'USDC' },
        hosts: { allow: ['127.0.0.1'] },
        triggers: [],
      },
      signer: ownerSigner,
      networks: ['solana-devnet'],
      rpcUrl: RPC,
      sourceTokenAccount: delegation.sourceTokenAccount,
      facilitator: FACILITATOR_URL,
      onReceipt: false,
    });

    const result = await buyer.fetch(`${sellerUrl}/quote`, { method: 'GET' });
    if (!result.receipt.tx_sig) {
      fatal(
        `settlement failed — reason=${result.failureReason ?? '(none)'}, ` +
          `decision=${result.receipt.decision}, status=${result.response.status}`,
      );
    }
    if (result.response.status !== 200) {
      fatal(`expected 200 after settlement, got ${result.response.status}`);
    }
    if (result.receipt.facilitator !== FACILITATOR_URL) {
      fatal(
        `receipt.facilitator mismatch — got "${result.receipt.facilitator}", ` +
          `expected "${FACILITATOR_URL}"`,
      );
    }
    if (!result.receipt.price?.amount) {
      fatal('receipt.price.amount missing — facilitator did not echo paymentRequirements');
    }

    ok(`status         : ${result.response.status}`);
    ok(`tx_sig         : ${result.receipt.tx_sig}`);
    ok(`receipt_hash   : ${result.receipt.receipt_hash}`);
    ok(`facilitator    : ${result.receipt.facilitator}`);
    ok(
      `price          : ${result.receipt.price.amount} ${result.receipt.price.currency} ` +
        `(${result.receipt.price.network})`,
    );

    console.log('\n============================================================');
    console.log('✓ SDK smoke test passed — local facilitator settles real txns');
    console.log('============================================================');
    console.log(`solscan: https://solscan.io/tx/${result.receipt.tx_sig}?cluster=devnet`);
  } finally {
    handle.close();
  }
}

main().catch((err: unknown) => {
  console.error('\n✗ unexpected error:', err);
  process.exit(1);
});
