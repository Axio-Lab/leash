import { serve } from '@hono/node-server';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { Hono } from 'hono';

import { createBuyer } from '@leashmarket/buyer-kit';
import { getSpendDelegation } from '@leashmarket/registry-utils';
import { createSeller } from '@leashmarket/seller-kit';

const OWNER_SECRET = required('LEASH_E2E_OWNER_SECRET');
const SELLER_AGENT = required('LEASH_E2E_SELLER_AGENT');
const BUYER_AGENT = required('LEASH_E2E_BUYER_AGENT');
const RPC = process.env.LEASH_E2E_RPC ?? 'https://api.devnet.solana.com';
const USDC_MINT = process.env.LEASH_E2E_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PORT = Number(process.env.LEASH_SMOKE_PORT ?? 4311);
const PATH = '/paid/quote';
const PRICE = process.env.LEASH_SMOKE_PRICE ?? '$0.0001';
const FACILITATOR_URL =
  process.env.LEASH_FACILITATOR_URL ?? 'https://facilitator-devnet.leash.market';
const URL = `http://127.0.0.1:${PORT}${PATH}`;
const API_URL = (process.env.LEASH_E2E_API_URL ?? '').replace(/\/+$/, '');
const API_KEY = process.env.LEASH_E2E_API_KEY ?? '';

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`missing env ${key}`);
  return value;
}

function decodeSecret(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) return Uint8Array.from(JSON.parse(trimmed) as number[]);
  return base58.serialize(trimmed);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function publishReceipt(receipt: { agent: string }) {
  if (!API_URL || !API_KEY) return;
  const res = await fetch(`${API_URL}/v1/receipts/${encodeURIComponent(receipt.agent)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(receipt),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`receipt publish failed: ${res.status} ${detail.slice(0, 160)}`);
  }
}

async function main() {
  const secret = decodeSecret(OWNER_SECRET);
  const signer = await createKeyPairSignerFromBytes(secret);
  const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

  const delegation = await getSpendDelegation(umi, {
    agentAsset: BUYER_AGENT,
    mint: USDC_MINT,
  });
  console.log(
    JSON.stringify({
      step: 'delegation',
      facilitator: FACILITATOR_URL,
      sourceTokenAccount: delegation.sourceTokenAccount,
      balance: delegation.balance.toString(),
      delegate: delegation.delegate,
      delegatedAmount: delegation.delegatedAmount.toString(),
      signer: String(signer.address),
    }),
  );
  assert(delegation.sourceExists, 'buyer USDC treasury ATA does not exist');
  assert(delegation.balance > 0n, 'buyer USDC treasury has zero balance');
  assert(
    delegation.delegate === String(signer.address),
    'owner wallet is not the treasury delegate',
  );
  assert(delegation.delegatedAmount > 0n, 'buyer treasury delegate allowance is zero');

  const app = new Hono();
  const sellerReceipts: unknown[] = [];
  createSeller(app, {
    umi,
    sellerAgent: { asset: SELLER_AGENT },
    network: 'solana-devnet',
    facilitator: FACILITATOR_URL,
    routes: {
      [`GET ${PATH}`]: {
        description: 'Local seller-kit x402 smoke endpoint',
        price: PRICE,
        currency: 'USDC',
        acceptsCurrencies: ['USDT', 'USDG'],
      },
    },
    onReceipt: (receipt) => {
      sellerReceipts.push(receipt);
      return publishReceipt(receipt);
    },
  });
  app.get(PATH, (c) =>
    c.json({
      ok: true,
      message: 'seller-kit endpoint unlocked',
      sellerAgent: SELLER_AGENT,
    }),
  );

  const server = serve({ fetch: app.fetch, port: PORT });
  try {
    await new Promise((resolve) => setTimeout(resolve, 350));

    const probe = await fetch(URL);
    const paymentRequired =
      probe.headers.get('payment-required') ?? probe.headers.get('PAYMENT-REQUIRED');
    console.log(
      JSON.stringify({
        step: 'anonymous-probe',
        status: probe.status,
        hasPaymentRequiredHeader: Boolean(paymentRequired),
      }),
    );
    assert(probe.status === 402, `expected anonymous probe 402, got ${probe.status}`);
    assert(paymentRequired, 'missing payment-required header on anonymous probe');

    const spendReceipts: unknown[] = [];
    const buyer = createBuyer({
      agent: BUYER_AGENT,
      rules: {
        v: '0.1',
        budget: { daily: '10', perCall: '0.01', currency: 'USDC' },
        hosts: { allow: ['127.0.0.1'] },
        triggers: [],
      },
      signer,
      networks: ['solana-devnet'],
      rpcUrl: RPC,
      sourceTokenAccount: delegation.sourceTokenAccount,
      preferredCurrency: 'USDC',
      onReceipt: (receipt) => {
        spendReceipts.push(receipt);
        return publishReceipt(receipt);
      },
    });

    const before = await getSpendDelegation(umi, {
      agentAsset: BUYER_AGENT,
      mint: USDC_MINT,
    });
    const result = await buyer.fetch(URL);
    const body = await result.response.json().catch(() => null);
    const after = await getSpendDelegation(umi, {
      agentAsset: BUYER_AGENT,
      mint: USDC_MINT,
    });
    console.log(
      JSON.stringify({
        step: 'paid-call',
        status: result.response.status,
        txSig: result.receipt.tx_sig,
        decision: result.receipt.decision,
        failureReason: result.failureReason ?? null,
        receiptHash: result.receipt.receipt_hash,
        body,
        debited: (before.balance - after.balance).toString(),
        spendReceiptCount: spendReceipts.length,
        sellerReceiptCount: sellerReceipts.length,
      }),
    );

    assert(result.response.ok, `paid call did not return 2xx: ${result.response.status}`);
    assert(result.receipt.tx_sig, `missing tx_sig; reason=${result.failureReason ?? 'unknown'}`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
