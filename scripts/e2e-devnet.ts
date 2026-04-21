/**
 * Real, end-to-end devnet scenario for the agent-funded x402 flow.
 *
 * What it does — entirely on Solana devnet, with a live facilitator:
 *
 *   1. Spins up an in-process Hono seller mounted via `@leash/seller-kit`,
 *      configured to receive on the seller agent's Asset Signer PDA.
 *   2. Reads (or creates) a delegation from the buyer agent's treasury USDC
 *      ATA to the executive keypair using `setSpendDelegation` from
 *      `@leash/registry-utils`.
 *   3. Fires a real `POST /pay` from `@leash/buyer-kit`'s
 *      `LeashDelegateExactSvmScheme` — the on-chain transfer is a vanilla
 *      `TransferChecked` signed by the executive as the SPL delegate of the
 *      agent treasury.
 *   4. Re-reads the delegation and prints the deltas so you can sanity-check
 *      that the call debited the treasury and reduced the remaining
 *      allowance by exactly the call price.
 *
 * No mocks, no smoke tests — every signature is real.
 *
 * Required env (all exist? you're golden):
 *
 *   LEASH_TEST_PAYER_SECRET_KEY     base58 OR JSON-array secret of the agent owner.
 *                                   Same wallet acts as the executive (delegate)
 *                                   so we can also sign the buyer-kit transfer.
 *   LEASH_TEST_BUYER_AGENT          Core asset address of the BUYER agent
 *                                   (the one whose treasury funds the call).
 *   LEASH_TEST_SELLER_AGENT         Core asset address of the SELLER agent
 *                                   (the one whose treasury receives funds).
 *
 * Optional:
 *
 *   LEASH_TEST_RPC                  Defaults to https://api.devnet.solana.com.
 *   LEASH_TEST_USDC_MINT            Defaults to circle devnet USDC.
 *   LEASH_TEST_PRICE_USDC           Decimal price the seller demands (default "0.001").
 *   LEASH_TEST_TOPUP_USDC           Top up the delegation to this many USDC if
 *                                   the current allowance can't cover the call
 *                                   (default: enough for one call).
 *   LEASH_FACILITATOR_URL           Override the facilitator (defaults to svmacc).
 *   LEASH_TEST_PORT                 Local seller port (default 3050).
 *
 * Pre-conditions on-chain:
 *
 *   - The payer keypair owns both LEASH_TEST_BUYER_AGENT and
 *     LEASH_TEST_SELLER_AGENT (mint via `createAgent` once if you haven't).
 *   - The buyer agent treasury holds at least `price` USDC. Send some to the
 *     printed treasury PDA from https://faucet.circle.com if you haven't.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore } from '@metaplex-foundation/mpl-core';

import { createBuyer } from '@leash/buyer-kit';
import { createSeller } from '@leash/seller-kit';
import { setSpendDelegation, getSpendDelegation } from '@leash/registry-utils';

const RPC = process.env.LEASH_TEST_RPC ?? 'https://api.devnet.solana.com';
const USDC = process.env.LEASH_TEST_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PRICE_USDC = process.env.LEASH_TEST_PRICE_USDC ?? '0.001';
const PORT = Number(process.env.LEASH_TEST_PORT ?? 3050);

const SECRET = process.env.LEASH_TEST_PAYER_SECRET_KEY;
const BUYER_AGENT = process.env.LEASH_TEST_BUYER_AGENT;
const SELLER_AGENT = process.env.LEASH_TEST_SELLER_AGENT;

if (!SECRET) throw new Error('Set LEASH_TEST_PAYER_SECRET_KEY (base58 or JSON array).');
if (!BUYER_AGENT) throw new Error('Set LEASH_TEST_BUYER_AGENT (core asset address).');
if (!SELLER_AGENT) throw new Error('Set LEASH_TEST_SELLER_AGENT (core asset address).');

function decodeSecret(raw: string): Uint8Array {
  const t = raw.trim();
  if (t.startsWith('[')) return Uint8Array.from(JSON.parse(t) as number[]);
  return base58.serialize(t);
}

function decimalToAtomicUsdc(input: string): bigint {
  const m = input.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) throw new Error(`bad USDC decimal: ${input}`);
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'));
}

const priceAtomic = decimalToAtomicUsdc(PRICE_USDC);
const topUpAtomic = decimalToAtomicUsdc(process.env.LEASH_TEST_TOPUP_USDC ?? PRICE_USDC);

async function main(): Promise<void> {
  // ---- Wallet setup (same keypair plays "owner" and "executive") ----
  const secret = decodeSecret(SECRET as string);
  const signer = await createKeyPairSignerFromBytes(secret);
  const executive = String(signer.address);

  const umi = createUmi(RPC).use(mplCore());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

  console.log('───── leash devnet e2e ─────');
  console.log('rpc       :', RPC);
  console.log('executive :', executive);
  console.log('buyer ag  :', BUYER_AGENT);
  console.log('seller ag :', SELLER_AGENT);
  console.log('price     :', PRICE_USDC, 'USDC =', priceAtomic.toString(), 'atomic');

  // ---- Ensure delegation covers the call ----
  let status = await getSpendDelegation(umi, {
    agentAsset: BUYER_AGENT as string,
    mint: USDC,
  });
  console.log('treasury  :', status.treasury);
  console.log('source ATA:', status.sourceTokenAccount);
  console.log('balance   :', status.balance.toString());
  console.log('delegate  :', status.delegate);
  console.log('allowance :', status.delegatedAmount.toString());

  if (status.balance < priceAtomic) {
    console.error(
      `treasury balance (${status.balance}) < price (${priceAtomic}). Send USDC to ${status.sourceTokenAccount} or treasury PDA ${status.treasury} from https://faucet.circle.com and rerun.`,
    );
    process.exit(2);
  }

  if (status.delegate !== executive || status.delegatedAmount < priceAtomic) {
    console.log(`approving ${topUpAtomic.toString()} atomic units of ${USDC} to ${executive}…`);
    const res = await setSpendDelegation(umi, {
      agentAsset: BUYER_AGENT as string,
      mint: USDC,
      executive,
      amount: topUpAtomic,
    });
    console.log('approved tx:', res.signature);
    status = await getSpendDelegation(umi, {
      agentAsset: BUYER_AGENT as string,
      mint: USDC,
    });
    console.log('new allowance:', status.delegatedAmount.toString());
  }

  // ---- In-process seller ----
  const sellerUmi = createUmi(RPC).use(mplCore());
  const app = new Hono();
  createSeller(app, {
    umi: sellerUmi,
    sellerAgent: { asset: SELLER_AGENT as string },
    routes: { 'POST /pay': { price: `$${PRICE_USDC}`, description: 'leash devnet e2e' } },
    onReceipt: async (r) => {
      console.log('seller receipt:', r.kind, r.tx_sig ?? '(no tx)');
    },
  });
  app.post('/pay', async (c) => c.json({ ok: true, ts: Date.now() }));

  const server = serve({ fetch: app.fetch, port: PORT });
  await sleep(250);
  console.log(`seller listening on http://127.0.0.1:${PORT}`);

  // ---- Buyer fires the call ----
  const buyer = createBuyer({
    agent: BUYER_AGENT as string,
    rules: {
      v: '0.1',
      budget: { daily: '1000000', perCall: '1000', currency: 'USDC' },
      hosts: { allow: ['127.0.0.1', 'localhost'] },
      triggers: [],
    },
    signer,
    networks: ['solana-devnet'],
    rpcUrl: RPC,
    sourceTokenAccount: status.sourceTokenAccount,
    onReceipt: async (r) => {
      console.log('buyer receipt:', r.kind, r.decision, r.tx_sig ?? '(no tx)');
    },
  });

  const before = await getSpendDelegation(umi, {
    agentAsset: BUYER_AGENT as string,
    mint: USDC,
  });

  console.log('firing buyer.fetch…');
  const callResult = await buyer.fetch(`http://127.0.0.1:${PORT}/pay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hi: 'leash' }),
  });

  console.log('response status:', callResult.response.status);
  console.log('tx_sig         :', callResult.receipt.tx_sig);
  if (!callResult.receipt.tx_sig) {
    console.error('NO SETTLEMENT — failure reason:', callResult.failureReason);
    process.exitCode = 3;
  }

  // Give the chain a moment, then re-read.
  await sleep(2000);
  const after = await getSpendDelegation(umi, {
    agentAsset: BUYER_AGENT as string,
    mint: USDC,
  });

  console.log('───── deltas ─────');
  console.log(
    'balance     before/after:',
    before.balance.toString(),
    '/',
    after.balance.toString(),
  );
  console.log(
    'allowance   before/after:',
    before.delegatedAmount.toString(),
    '/',
    after.delegatedAmount.toString(),
  );
  console.log('expected debit          :', priceAtomic.toString(), '(call price in atomic units)');

  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
