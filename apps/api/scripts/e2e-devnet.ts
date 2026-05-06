/**
 * End-to-end devnet smoke test for the @leashmarket/api surface.
 *
 * What this script proves
 * -----------------------
 * The shipped HTTP API exposes the same primitives as `@leashmarket/seller-kit`
 * and `@leashmarket/buyer-kit`, plus the hosted-paywall flow on `/x/{id}`. This
 * script drives every public endpoint that contributes to that flow against
 * a *real* Leash API process (local by default) and a *real* Solana devnet,
 * and asserts that:
 *
 *   1. seller utilities (`/v1/seller/networks` etc.) return the expected
 *      registry data and PDA derivations,
 *   2. buyer utilities (`/v1/buyer/networks`, `/v1/buyer/currency`,
 *      `/v1/buyer/policy/evaluate`, `/v1/buyer/quote`) work without any
 *      on-chain side effects,
 *   3. payment-link CRUD (`/v1/payment-links`) creates, reads and updates
 *      links and renders the same accepts[] preview shape,
 *   4. the public paywall on `/x/{id}` returns 402 with `payment-required`
 *      to anonymous probes, and 200 with `PAYMENT-RESPONSE` after a real
 *      x402 settlement,
 *   5. each settlement bumps `payment_links.{call_count,settled_count}`,
 *      ingests both the seller-side `earn` and the buyer-side `spend`
 *      `ReceiptV1` (the latter via `createBuyer({ onReceipt })` POSTing
 *      to `/v1/receipts/{agent}`), and emits the matching
 *      `payment_link.served`, `payment_link.settled`, `receipt.published`
 *      events that the explorer + indexer pages read.
 *
 * The script is deliberately end-to-end: every signature is a real on-chain
 * transaction signed by a real keypair, and every receipt is verified
 * against the production-shaped `receipts` table in the API's database.
 *
 * Required env
 * ------------
 *   LEASH_E2E_API_URL          Base URL of the Leash API (default: http://localhost:8801)
 *   LEASH_E2E_API_KEY          `lsh_test_*` API key (devnet)
 *   LEASH_E2E_OWNER_SECRET     Base58 OR JSON-array secret of the agent owner.
 *                              This wallet pays for everything (mints, ATAs,
 *                              delegations) AND acts as the buyer agent's
 *                              executive (so we can sign the SPL transfer).
 *
 * Optional env
 * ------------
 *   LEASH_E2E_RPC              Devnet RPC (default: https://api.devnet.solana.com)
 *   LEASH_E2E_USDC_MINT        Default: Circle's devnet USDC.
 *   LEASH_E2E_USDG_MINT        Default: Paxos devnet USDG (Token-2022).
 *   LEASH_E2E_PRICE            Display price string (default: "$0.001")
 *   LEASH_E2E_BUYER_AGENT      Skip buyer mint and reuse this asset.
 *   LEASH_E2E_SELLER_AGENT     Skip seller mint and reuse this asset.
 *   LEASH_E2E_AGENT_URI        Metadata URI used when minting fresh agents.
 *                              Default: https://leash.market/test-agent.json
 *   LEASH_E2E_FUND_USDC        Atomic units of USDC to send to the buyer
 *                              treasury when its balance is too low.
 *                              Default: 100_000 (= 0.1 USDC), enough for
 *                              dozens of $0.001 calls.
 *   LEASH_E2E_DELEGATE_USDC    Atomic units to set as the spend allowance.
 *                              Default: 100_000.
 *   LEASH_E2E_FUND_USDG        Atomic units of USDG to ensure the buyer
 *                              treasury holds. Owner must have at least
 *                              this much USDG in their ATA. Default:
 *                              5_000_000 (= 5 USDG).
 *   LEASH_E2E_DELEGATE_USDG    Atomic units to set as the USDG spend
 *                              allowance. Default: 5_000_000.
 *   LEASH_E2E_KEEP_LINK        "1" to skip cleanup at the end so you can
 *                              poke the link in the explorer manually.
 *   LEASH_E2E_MPP              "1" to additionally run a hosted **MPP** payment
 *                              link (`protocol: "mpp"`) through the same API:
 *                              create link → 402 `problem+json` probe → real
 *                              `buyer.fetch` settlement on devnet (requires a
 *                              facilitator that supports `POST /mpp/settle`).
 *
 * Usage
 * -----
 *   pnpm --filter @leashmarket/api e2e:devnet
 *   pnpm --filter @leashmarket/api e2e:devnet:mpp   # same as above + MPP link (LEASH_E2E_MPP=1)
 * or:
 *   cd apps/api && node --env-file=.env.e2e --import tsx ./scripts/e2e-devnet.ts
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { createKeyPairSignerFromBytes } from '@solana/kit';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  keypairIdentity,
  publicKey,
  transactionBuilder,
  type Instruction,
  type Umi,
  type PublicKey,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore, findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { mplToolbox, findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import { createTokenIfMissing, transferTokens, fetchToken } from '@metaplex-foundation/mpl-toolbox';

import { createBuyer } from '@leashmarket/buyer-kit';
import {
  createAgent,
  setSpendDelegation,
  getSpendDelegation,
  provisionTreasuryAtas,
  TOKEN_2022_PROGRAM_ID,
} from '@leashmarket/registry-utils';

import { isReceiptV02 } from '@leashmarket/schemas';

import {
  isNoOp,
  signWireTransaction,
  waitForEvent,
  type EventRow,
  type PreparedEnvelope,
  type SubmitResponse,
} from './lib/api-prepare-submit.js';

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const API_URL = (process.env.LEASH_E2E_API_URL ?? 'http://localhost:8801').replace(/\/+$/, '');
const API_KEY = required('LEASH_E2E_API_KEY');
const OWNER_SECRET = required('LEASH_E2E_OWNER_SECRET');
const RPC = process.env.LEASH_E2E_RPC ?? 'https://api.devnet.solana.com';
const USDC_MINT = process.env.LEASH_E2E_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
// Devnet USDG (Token-2022). Override with LEASH_E2E_USDG_MINT.
const USDG_MINT = process.env.LEASH_E2E_USDG_MINT ?? '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7';
const PRICE = process.env.LEASH_E2E_PRICE ?? '$0.001';
const AGENT_URI = process.env.LEASH_E2E_AGENT_URI ?? 'https://leash.market/test-agent.json';
const FUND_USDC = BigInt(process.env.LEASH_E2E_FUND_USDC ?? '100000'); // 0.1 USDC
const DELEGATE_USDC = BigInt(process.env.LEASH_E2E_DELEGATE_USDC ?? '100000'); // 0.1 USDC
// How much USDG (atomic, 6 dec) to ensure the buyer holds and is delegated.
const FUND_USDG = BigInt(process.env.LEASH_E2E_FUND_USDG ?? '5000000'); // 5 USDG
const DELEGATE_USDG = BigInt(process.env.LEASH_E2E_DELEGATE_USDG ?? '5000000'); // 5 USDG
const KEEP_LINK = process.env.LEASH_E2E_KEEP_LINK === '1';

if (!API_KEY.startsWith('lsh_test_')) {
  fatal(`expected a devnet key (lsh_test_*), got "${API_KEY.slice(0, 12)}…"`);
}

// ────────────────────────────────────────────────────────────────────────────
// Tiny logger / assert helpers
// ────────────────────────────────────────────────────────────────────────────

let stepNum = 0;
function step(title: string): void {
  stepNum += 1;
  console.log(`\n──── ${stepNum}. ${title} ────`);
}
function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}
function info(msg: string): void {
  console.log(`  · ${msg}`);
}
function warn(msg: string): void {
  console.warn(`  ! ${msg}`);
}
function fatal(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}
function required(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) fatal(`missing env ${key}`);
  return v;
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) fatal(`assertion failed: ${msg}`);
}
function decodeSecret(raw: string): Uint8Array {
  const t = raw.trim();
  if (t.startsWith('[')) return Uint8Array.from(JSON.parse(t) as number[]);
  return base58.serialize(t);
}

// ────────────────────────────────────────────────────────────────────────────
// API client (every authed call goes through `api(...)`)
// ────────────────────────────────────────────────────────────────────────────

type ApiInit = Omit<RequestInit, 'headers' | 'body'> & {
  headers?: Record<string, string>;
  body?: unknown;
  expectStatus?: number | number[];
};

async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const expect = init.expectStatus ?? 200;
  const expectArr = Array.isArray(expect) ? expect : [expect];
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${API_KEY}`,
    ...(init.headers ?? {}),
  };
  if (init.body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...init,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* leave as text */
  }
  if (!expectArr.includes(res.status)) {
    fatal(
      `${init.method ?? 'GET'} ${path} → ${res.status} ${res.statusText}\n${text.slice(0, 800)}`,
    );
  }
  return parsed as T;
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let mppLinkId: string | undefined;
  console.log('============================================================');
  console.log('Leash API end-to-end devnet test');
  console.log('============================================================');
  console.log(`api      : ${API_URL}`);
  console.log(`rpc      : ${RPC}`);
  console.log(`api key  : ${API_KEY.slice(0, 16)}…${API_KEY.slice(-4)}`);
  console.log(`usdc mint: ${USDC_MINT}`);
  console.log(`usdg mint: ${USDG_MINT}`);
  console.log(`price    : ${PRICE}`);
  console.log(`mpp pass : ${process.env.LEASH_E2E_MPP === '1' ? 'yes (LEASH_E2E_MPP=1)' : 'no'}`);

  // ───── 1. health ─────
  step('GET /v1/health');
  const health = await api<{ ok: boolean }>('/v1/health');
  assert(health.ok === true, 'health.ok should be true');
  ok(`API is up — ${JSON.stringify(health)}`);

  // ───── 2. wallet + umi ─────
  step('Bootstrap owner wallet + umi');
  const ownerSecret = decodeSecret(OWNER_SECRET);
  const ownerSigner = await createKeyPairSignerFromBytes(ownerSecret);
  const ownerPubkey = String(ownerSigner.address);
  const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(ownerSecret)));
  ok(`owner wallet: ${ownerPubkey}`);

  // ───── 3. seller utilities (pure HTTP) ─────
  step('Seller utilities — /v1/seller/networks, /facilitator, /parse-price');
  const networks = await api<{
    items: Array<{ network: string; accepts: string[] }>;
    current: { network: string };
  }>('/v1/seller/networks');
  assert(
    networks.current.network === 'solana-devnet',
    `expected current=solana-devnet, got ${networks.current.network}`,
  );
  ok(
    `networks: ${networks.items.map((i) => i.network).join(', ')}; current=${networks.current.network}`,
  );

  const facilitator = await api<{ network: string; facilitator: string; source: string }>(
    '/v1/seller/facilitator',
  );
  assert(facilitator.network === 'solana-devnet', 'facilitator.network mismatch');
  assert(facilitator.facilitator.startsWith('http'), 'facilitator URL should be HTTPS-able');
  ok(`facilitator: ${facilitator.facilitator} (${facilitator.source})`);

  const parsed = await api<{ amount: string; currency: string; equivalents: unknown[] }>(
    '/v1/seller/parse-price',
    { method: 'POST', body: { price: PRICE } },
  );
  assert(parsed.amount === '1000', `expected $0.001 → 1000 atomic, got ${parsed.amount}`);
  ok(
    `parse-price("${PRICE}") → ${parsed.amount} atomic ${parsed.currency} (+${parsed.equivalents.length} equivalents)`,
  );

  // ───── 4. buyer utilities (pure HTTP) ─────
  step('Buyer utilities — /v1/buyer/networks, /currency, /policy/evaluate');
  const buyerNetworks = await api<{ current: { network: string }; items: unknown[] }>(
    '/v1/buyer/networks',
  );
  assert(buyerNetworks.current.network === 'solana-devnet', 'buyer networks current mismatch');
  ok(
    `buyer networks: ${buyerNetworks.items.length} entries; current=${buyerNetworks.current.network}`,
  );

  const currency = await api<{ network: string; items: Array<{ symbol: string; mint: string }> }>(
    '/v1/buyer/currency',
  );
  assert(currency.items.length > 0, 'buyer/currency should list at least USDC');
  const usdcEntry = currency.items.find((c) => c.mint === USDC_MINT);
  assert(usdcEntry !== undefined, `currency catalog missing USDC mint ${USDC_MINT}`);
  ok(`buyer currency catalog: ${currency.items.map((c) => c.symbol).join(', ')}`);

  const policy = await api<{ decision: string; request_hash: string }>(
    '/v1/buyer/policy/evaluate',
    {
      method: 'POST',
      body: {
        request: {
          method: 'GET',
          url: 'https://api.example.com/quote',
          estimated_price: '0.001',
        },
        rules: {
          v: '0.1',
          budget: { daily: '10', perCall: '0.01', currency: 'USDC' },
          hosts: { allow: ['api.example.com'] },
          triggers: [],
        },
        state: { spent_today: '0.5', recent_request_hashes: [] },
      },
    },
  );
  assert(policy.decision === 'allow', `expected allow, got ${policy.decision}`);
  ok(`policy.evaluate → ${policy.decision} (request_hash=${policy.request_hash.slice(0, 16)}…)`);

  // ───── 5. resolve / mint two agents (seller + buyer) ─────
  step('Resolve seller + buyer agents (mint if not provided via env)');
  const sellerAgent = await ensureAgent(
    umi,
    ownerPubkey,
    'seller',
    process.env.LEASH_E2E_SELLER_AGENT,
  );
  const buyerAgent = await ensureAgent(
    umi,
    ownerPubkey,
    'buyer',
    process.env.LEASH_E2E_BUYER_AGENT,
  );
  ok(`seller agent: ${sellerAgent}`);
  ok(`buyer  agent: ${buyerAgent}`);

  // ───── 6. seller pay-to derivation matches the SDK ─────
  step('GET /v1/agents/{seller}/pay-to (Asset Signer PDA)');
  const payToView = await api<{ pay_to: string }>(`/v1/agents/${sellerAgent}/pay-to`);
  const [sdkSellerPdaPubkey] = findAssetSignerPda(umi, { asset: publicKey(sellerAgent) });
  const sdkSellerPda = String(sdkSellerPdaPubkey);
  assert(
    payToView.pay_to === sdkSellerPda,
    `pay-to mismatch: api=${payToView.pay_to}, sdk=${sdkSellerPda}`,
  );
  ok(`seller payTo (API == SDK): ${payToView.pay_to}`);

  // ───── 7. provision treasury ATAs through the API (prepare → sign → submit) ─────
  // We deliberately go through the HTTP API here (instead of calling
  // `provisionTreasuryAtas` directly via the SDK) so the explorer ends
  // up with a real `agent.treasury.provision` event row whose lifecycle
  // we can observe end-to-end. The buyer agent is provisioned via the
  // SDK *after* this step because the delegation flow further down
  // needs the buyer USDC ATA to already exist regardless of whether
  // the API path picked a fresh tx or returned `no_op: true`.
  step('Provision seller treasury through /v1/agents/{seller}/treasury/provision/prepare');
  const sellerProvision = await api<
    PreparedEnvelope<{ atas: Array<{ symbol?: string; created: boolean }> }>
  >(`/v1/agents/${sellerAgent}/treasury/provision/prepare`, {
    method: 'POST',
    body: { payer: ownerPubkey, authority: ownerPubkey },
  });
  if (isNoOp(sellerProvision)) {
    ok(
      `provision is no-op (every supported ATA already exists: ${sellerProvision.echo.atas
        .map((a) => a.symbol ?? '?')
        .join(', ')})`,
    );
  } else {
    info(`event_id   : ${sellerProvision.event_id}`);
    info(
      `will create: ${
        sellerProvision.echo.atas
          .filter((a) => a.created)
          .map((a) => a.symbol ?? '?')
          .join(', ') || '(none — refresh-only)'
      }`,
    );
    const signed = await signWireTransaction(umi, sellerProvision.transaction, [umi.identity]);
    const submitted = await api<SubmitResponse>('/v1/submit', {
      method: 'POST',
      body: { event_id: sellerProvision.event_id, transaction_base64: signed },
    });
    ok(`submitted tx_sig: ${submitted.signature}`);
    const final = await waitForEvent(
      (id) => api<EventRow>(`/v1/events/${id}`),
      sellerProvision.event_id,
      { timeoutMs: 90_000 },
    );
    if (final.phase !== 'confirmed') {
      fatal(
        `treasury.provision did not confirm — phase=${final.phase}, error_code=${final.error_code ?? 'n/a'}`,
      );
    }
    ok(`provision confirmed in event ${final.id}`);
  }

  step('GET /v1/events?kind=agent.treasury.provision — explorer feed sees it');
  const provisionEvents = await api<{
    items: Array<{ id: string; kind: string; phase: string; agent_asset: string | null }>;
  }>(`/v1/events?kind=agent.treasury.provision&agent=${sellerAgent}&limit=5`);
  // The API only writes a `prepared` row when there's a real transaction
  // to sign. When every supported ATA already exists, `provision/prepare`
  // short-circuits with `no_op: true` and (correctly) doesn't enqueue
  // anything for the explorer feed. In that case, "0 rows" is the
  // expected indexer state for a brand-new agent — older agents that
  // were provisioned via the SDK *or* through a previous API run will
  // still have rows here, so we only assert the feed query is shaped
  // correctly and log whatever's on file.
  if (isNoOp(sellerProvision)) {
    ok(
      provisionEvents.items.length === 0
        ? 'no provision events on file (seller treasury was provisioned out-of-band — expected for SDK-only setups)'
        : `${provisionEvents.items.length} historical provision event(s) on file (latest phase=${provisionEvents.items[0]?.phase})`,
    );
  } else {
    assert(
      provisionEvents.items.length >= 1,
      'no agent.treasury.provision event indexed for the seller after the API drove a real prepare → submit',
    );
    ok(
      `${provisionEvents.items.length} provision event(s) on file, latest phase=${provisionEvents.items[0]?.phase}`,
    );
  }

  step('Provision buyer treasury directly via SDK (needed for delegation step)');
  const buyerProvision = await provisionTreasuryAtas(umi, {
    agentAsset: buyerAgent,
    network: 'solana-devnet',
  });
  info(
    `buyer treasury ATAs: ${buyerProvision.atas
      .map((a) => `${a.symbol ?? a.mint.slice(0, 4)}=${a.created ? 'new' : 'ok'}`)
      .join(' ')}`,
  );

  // ───── 8. fund the buyer treasury USDC if low ─────
  step('Top up buyer treasury USDC if low');
  const buyerStatus = await getSpendDelegation(umi, { agentAsset: buyerAgent, mint: USDC_MINT });
  info(`buyer treasury USDC ATA: ${buyerStatus.sourceTokenAccount}`);
  info(`buyer treasury balance : ${buyerStatus.balance.toString()} atomic`);
  if (buyerStatus.balance < FUND_USDC) {
    const need = FUND_USDC - buyerStatus.balance;
    info(`balance below ${FUND_USDC.toString()}, sending ${need.toString()} USDC from owner…`);
    await ensureOwnerHasUsdc(umi, ownerPubkey, need);
    const sig = await transferOwnerUsdcTo(umi, ownerPubkey, buyerStatus.sourceTokenAccount, need);
    ok(`top-up tx: ${sig}`);
    const after = await pollDelegation(umi, buyerAgent, (s) => s.balance >= FUND_USDC, 'balance');
    info(`buyer balance after top-up: ${after.balance.toString()} atomic`);
  } else {
    ok(`balance already covers e2e (${buyerStatus.balance.toString()} >= ${FUND_USDC.toString()})`);
  }

  // ───── 9. set spend delegation for buyer treasury → owner-as-executive ─────
  step('Approve owner as SPL spend delegate for buyer treasury USDC');
  let delegation = await getSpendDelegation(umi, { agentAsset: buyerAgent, mint: USDC_MINT });
  if (delegation.delegate !== ownerPubkey || delegation.delegatedAmount < DELEGATE_USDC) {
    const res = await setSpendDelegation(umi, {
      agentAsset: buyerAgent,
      mint: USDC_MINT,
      executive: ownerPubkey,
      amount: DELEGATE_USDC,
    });
    ok(`approved tx: ${res.signature}`);
    delegation = await pollDelegation(
      umi,
      buyerAgent,
      (s) => s.delegate === ownerPubkey && s.delegatedAmount >= DELEGATE_USDC,
      'delegation',
    );
  }
  info(`delegate : ${delegation.delegate}`);
  info(`allowance: ${delegation.delegatedAmount.toString()} atomic`);
  assert(delegation.delegate === ownerPubkey, 'delegate should be owner');
  assert(delegation.delegatedAmount >= DELEGATE_USDC, 'delegated amount too low');

  // ───── 9b. USDG fund + delegation (Token-2022) ─────
  step('Top up buyer treasury USDG and approve USDG spend delegation (Token-2022)');
  let usdgDelegation = await getSpendDelegation(umi, {
    agentAsset: buyerAgent,
    mint: USDG_MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  info(`buyer treasury USDG ATA    : ${usdgDelegation.sourceTokenAccount}`);
  info(`buyer treasury USDG balance: ${usdgDelegation.balance.toString()} atomic`);

  let usdgFunded = usdgDelegation.balance >= FUND_USDG;
  if (!usdgFunded) {
    const need = FUND_USDG - usdgDelegation.balance;
    info(`balance below ${FUND_USDG.toString()}, sending ${need.toString()} USDG from owner…`);
    const result = await ensureBuyerHasUsdg(umi, {
      owner: ownerPubkey,
      destAta: usdgDelegation.sourceTokenAccount,
      need,
    });
    if (!result.funded) {
      warn(`USDG top-up skipped — ${result.reason ?? 'unknown reason'}`);
    } else {
      // Wait for the new balance to land before reading delegation again.
      usdgDelegation = await pollDelegationMint(
        umi,
        buyerAgent,
        USDG_MINT,
        TOKEN_2022_PROGRAM_ID,
        (s) => s.balance >= FUND_USDG,
        'usdg-balance',
      );
      info(`buyer USDG balance after top-up: ${usdgDelegation.balance.toString()} atomic`);
      usdgFunded = true;
    }
  } else {
    ok(`balance already covers e2e (${usdgDelegation.balance} >= ${FUND_USDG})`);
  }

  if (usdgFunded) {
    if (usdgDelegation.delegate !== ownerPubkey || usdgDelegation.delegatedAmount < DELEGATE_USDG) {
      const res = await setSpendDelegation(umi, {
        agentAsset: buyerAgent,
        mint: USDG_MINT,
        executive: ownerPubkey,
        amount: DELEGATE_USDG,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });
      ok(`USDG approved tx: ${res.signature}`);
      usdgDelegation = await pollDelegationMint(
        umi,
        buyerAgent,
        USDG_MINT,
        TOKEN_2022_PROGRAM_ID,
        (s) => s.delegate === ownerPubkey && s.delegatedAmount >= DELEGATE_USDG,
        'usdg-delegation',
      );
    }
    info(`USDG delegate : ${usdgDelegation.delegate}`);
    info(`USDG allowance: ${usdgDelegation.delegatedAmount.toString()} atomic`);
    ok(`USDG delegation ready`);
  }

  // ───── 10. preview a payment link draft (no persist) ─────
  step('POST /v1/payment-links/preview — render accepts[] without persisting');
  const preview = await api<{
    pay_to: string;
    accepts: Array<{ amount: string; currency: string }>;
  }>('/v1/payment-links/preview', {
    method: 'POST',
    body: {
      label: 'preview',
      owner_agent: sellerAgent,
      method: 'GET',
      price: PRICE,
      currency: 'USDC',
      response: {
        status: 200,
        mimeType: 'application/json',
        body: { ok: true },
      },
    },
  });
  assert(preview.pay_to === sdkSellerPda, 'preview.pay_to mismatch with SDK PDA');
  assert(preview.accepts.length >= 1, 'preview.accepts empty');
  ok(
    `preview accepts[0]: ${preview.accepts[0].amount} ${preview.accepts[0].currency} → ${preview.pay_to}`,
  );

  // ───── 11. create the payment link ─────
  step('POST /v1/payment-links — create the hosted paywall');
  const link = await api<{
    id: string;
    share_url: string;
    pay_to: string;
    accepts: Array<{ amount: string; currency: string; asset: string }>;
    counters: { call_count: number; settled_count: number };
  }>('/v1/payment-links', {
    method: 'POST',
    body: {
      label: `e2e-${Date.now()}`,
      owner_agent: sellerAgent,
      method: 'GET',
      price: PRICE,
      currency: 'USDC',
      accepts_currencies: ['USDC', 'USDG'],
      response: {
        status: 200,
        mimeType: 'application/json',
        body: { ok: true, message: 'paid via e2e' },
      },
      metadata: { source: 'apps/api/scripts/e2e-devnet.ts' },
    },
  });
  ok(`payment link id   : ${link.id}`);
  ok(`payment link url  : ${link.share_url}`);
  ok(`payment link payTo: ${link.pay_to}`);
  assert(
    link.share_url.startsWith(API_URL),
    `share_url ${link.share_url} should start with API_URL ${API_URL}; ` +
      'set LEASH_API_PUBLIC_ORIGIN to match.',
  );
  assert(link.counters.call_count === 0 && link.counters.settled_count === 0, 'fresh counters');
  const linkId = link.id;
  const shareUrl = link.share_url;

  // ───── 12. round-trip read ─────
  step('GET /v1/payment-links/{id} — round-trip read');
  const reread = await api<{ id: string; counters: { call_count: number } }>(
    `/v1/payment-links/${linkId}`,
  );
  assert(reread.id === linkId, 'round-trip id mismatch');
  ok(`round-trip OK (call_count=${reread.counters.call_count})`);

  // ───── 13. quote the paywall through the API ─────
  step('POST /v1/buyer/quote — quote the share_url');
  const quote = await api<{
    status: number;
    accepts: Array<{ amount: string; asset: string }>;
    chosen: { amount: string; asset: string } | null;
    requirements_hash: string;
  }>('/v1/buyer/quote', {
    method: 'POST',
    body: { url: `${shareUrl}?network=solana-devnet`, method: 'GET' },
  });
  assert(quote.status === 402, `quote should see a 402; got ${quote.status}`);
  assert(quote.chosen !== null, 'quote.chosen is null — wrong network on the API key?');
  assert(
    quote.chosen.amount === preview.accepts[0].amount,
    `quote amount ${quote.chosen.amount} != preview ${preview.accepts[0].amount}`,
  );
  ok(`402 + chosen=${quote.chosen.amount} ${quote.chosen.asset.slice(0, 6)}…`);
  ok(`requirements_hash=${quote.requirements_hash.slice(0, 16)}…`);

  // ───── 14. anonymous probe of the paywall returns 402 directly ─────
  step('GET /x/{id} — anonymous probe must return 402');
  const probeRes = await fetch(`${shareUrl}?network=solana-devnet`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  assert(
    probeRes.status === 402,
    `paywall should respond with 402 for unpaid request, got ${probeRes.status}`,
  );
  const probeReq =
    probeRes.headers.get('payment-required') ?? probeRes.headers.get('PAYMENT-REQUIRED');
  assert(probeReq && probeReq.length > 0, 'paywall must include PAYMENT-REQUIRED header');
  ok(`paywall returned 402 with PAYMENT-REQUIRED (${probeReq.length} bytes)`);

  // ───── 15. real x402 settlement against the paywall ─────
  step('createBuyer.fetch(share_url) — real settlement on devnet');
  const buyer = createBuyer({
    agent: buyerAgent,
    rules: {
      v: '0.1',
      budget: { daily: '10', perCall: '0.01', currency: 'USDC' },
      hosts: { allow: [new URL(shareUrl).hostname] },
      triggers: [],
    },
    signer: ownerSigner,
    networks: ['solana-devnet'],
    rpcUrl: RPC,
    sourceTokenAccount: delegation.sourceTokenAccount,
    // The seller paywall ingests the EARN receipt automatically. The
    // SPEND receipt is a separate document that only exists on the
    // buyer side — POST it to /v1/receipts/{agent} so the explorer can
    // display the full pair, otherwise the receipts feed only ever
    // shows earn rows.
    onReceipt: async (receipt) => {
      try {
        await api(`/v1/receipts/${receipt.agent}`, {
          method: 'POST',
          body: receipt,
        });
      } catch (err) {
        info(`spend-receipt ingest failed (non-fatal): ${(err as Error).message}`);
      }
    },
  });

  const before = await getSpendDelegation(umi, { agentAsset: buyerAgent, mint: USDC_MINT });
  const callResult = await buyer.fetch(`${shareUrl}?network=solana-devnet`, { method: 'GET' });
  if (!callResult.receipt.tx_sig) {
    fatal(
      `settlement failed; reason=${callResult.failureReason ?? '(none)'}\n` +
        `decision=${callResult.receipt.decision}, response=${callResult.response.status}`,
    );
  }
  ok(`response status: ${callResult.response.status}`);
  ok(`tx_sig         : ${callResult.receipt.tx_sig}`);
  ok(`receipt_hash   : ${callResult.receipt.receipt_hash}`);

  await sleep(3_000);
  const after = await getSpendDelegation(umi, { agentAsset: buyerAgent, mint: USDC_MINT });
  const debited = before.balance - after.balance;
  info(
    `buyer balance before/after: ${before.balance.toString()} / ${after.balance.toString()} (debited ${debited.toString()})`,
  );

  // ───── 15b. USDG settlement (if buyer has enough USDG + delegation) ─────
  let usdgTxSig: string | undefined;
  if (usdgFunded && usdgDelegation.delegate === ownerPubkey) {
    step('createBuyer.fetch(share_url) — USDG settlement on devnet (Token-2022)');
    const usdgBuyer = createBuyer({
      agent: buyerAgent,
      rules: {
        v: '0.1',
        budget: { daily: '10', perCall: '0.01', currency: 'USDC' },
        hosts: { allow: [new URL(shareUrl).hostname] },
        triggers: [],
      },
      signer: ownerSigner,
      networks: ['solana-devnet'],
      rpcUrl: RPC,
      sourceTokenAccount: usdgDelegation.sourceTokenAccount,
      preferredCurrency: 'USDG',
      onReceipt: async (receipt) => {
        try {
          await api(`/v1/receipts/${receipt.agent}`, {
            method: 'POST',
            body: receipt,
          });
        } catch (err) {
          info(`usdg spend-receipt ingest failed (non-fatal): ${(err as Error).message}`);
        }
      },
    });

    const usdgBefore = await getSpendDelegation(umi, {
      agentAsset: buyerAgent,
      mint: USDG_MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    const usdgResult = await usdgBuyer.fetch(`${shareUrl}?network=solana-devnet`, {
      method: 'GET',
    });
    if (!usdgResult.receipt.tx_sig) {
      warn(
        `USDG settlement failed (non-fatal); reason=${usdgResult.failureReason ?? '(none)'}\n` +
          `decision=${usdgResult.receipt.decision}`,
      );
    } else {
      usdgTxSig = usdgResult.receipt.tx_sig;
      ok(`USDG response status: ${usdgResult.response.status}`);
      ok(`USDG tx_sig         : ${usdgTxSig}`);
      ok(`USDG receipt_hash   : ${usdgResult.receipt.receipt_hash}`);
      await sleep(3_000);
      const usdgAfter = await getSpendDelegation(umi, {
        agentAsset: buyerAgent,
        mint: USDG_MINT,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });
      const usdgDebited = usdgBefore.balance - usdgAfter.balance;
      info(
        `USDG balance before/after: ${usdgBefore.balance.toString()} / ${usdgAfter.balance.toString()} (debited ${usdgDebited.toString()})`,
      );
    }
  } else {
    info(
      `USDG settlement skipped — balance=${usdgDelegation.balance}, delegate=${usdgDelegation.delegate ?? 'none'} (need ≥ ${FUND_USDG} + delegation to owner)`,
    );
  }

  // ───── 15c. Deliberate failure — payment exceeds buyer balance ─────
  // Create a second payment link with a price the buyer can't afford
  // (e.g. $5 = 5_000_000 atomic USDC vs delegation cap of DELEGATE_USDC),
  // then attempt to settle it with permissive rules so the buyer-kit
  // doesn't deny at policy time and we exercise the *settlement* failure
  // path. The resulting `decision: 'rejected'` receipt is POSTed to the
  // API and surfaced in the explorer's receipts feed, proving failed
  // transactions are observable end-to-end.
  step('POST /v1/payment-links — create over-budget link for failure test');
  const FAIL_PRICE = '$5'; // 5_000_000 atomic USDC, way above DELEGATE_USDC (100_000)
  const failLink = await api<{ id: string; share_url: string; pay_to: string }>(
    '/v1/payment-links',
    {
      method: 'POST',
      body: {
        label: `e2e-fail-${Date.now()}`,
        owner_agent: sellerAgent,
        method: 'GET',
        price: FAIL_PRICE,
        currency: 'USDC',
        response: {
          status: 200,
          mimeType: 'application/json',
          body: { ok: true, message: 'unreachable — buyer cannot afford' },
        },
        metadata: { source: 'apps/api/scripts/e2e-devnet.ts', expect: 'failure' },
      },
    },
  );
  ok(`fail link id : ${failLink.id}`);
  ok(`fail link url: ${failLink.share_url} (price=${FAIL_PRICE})`);

  step('createBuyer.fetch(fail_link) — must surface decision=rejected');
  type CapturedReceipt = { receipt_hash: string; decision: string; reason: string | null };
  let failReceipt = null as CapturedReceipt | null;
  const failBuyer = createBuyer({
    agent: buyerAgent,
    rules: {
      v: '0.1',
      // Permissive policy so the kit doesn't deny at policy time — we
      // want the *settlement* path to fail (insufficient_balance /
      // simulation_failed), not the policy gate.
      budget: { daily: '1000', perCall: '100', currency: 'USDC' },
      hosts: { allow: [new URL(failLink.share_url).hostname] },
      triggers: [],
    },
    signer: ownerSigner,
    networks: ['solana-devnet'],
    rpcUrl: RPC,
    sourceTokenAccount: delegation.sourceTokenAccount,
    onReceipt: async (receipt) => {
      failReceipt = {
        receipt_hash: receipt.receipt_hash,
        decision: receipt.decision,
        reason: receipt.reason ?? null,
      };
      try {
        await api(`/v1/receipts/${receipt.agent}`, { method: 'POST', body: receipt });
      } catch (err) {
        info(`fail spend-receipt ingest failed (non-fatal): ${(err as Error).message}`);
      }
    },
  });

  const failResult = await failBuyer.fetch(`${failLink.share_url}?network=solana-devnet`, {
    method: 'GET',
  });
  assert(
    failResult.receipt.decision === 'rejected',
    `expected rejected, got ${failResult.receipt.decision}`,
  );
  assert(failResult.receipt.tx_sig === null, 'rejected receipts should have null tx_sig');
  ok(`response status   : ${failResult.response.status} (rejected as expected)`);
  ok(`failure reason    : ${failResult.failureReason ?? '(none)'}`);
  ok(`receipt decision  : ${failResult.receipt.decision}`);
  ok(`receipt hash      : ${failResult.receipt.receipt_hash}`);

  // Wait for the rejected spend receipt to land in the explorer feed.
  step('GET /v1/receipts/{buyer} — rejected spend receipt visible in explorer');
  let rejectedReceipt:
    | { kind: string; decision: string; receipt_hash: string; reason: string | null }
    | undefined;
  for (let i = 0; i < 12 && rejectedReceipt === undefined; i += 1) {
    const buyerReceipts = await api<{
      items: Array<{
        kind: string;
        decision: string;
        receipt_hash: string;
        reason: string | null;
      }>;
    }>(`/v1/receipts/${buyerAgent}?limit=10`);
    rejectedReceipt = buyerReceipts.items.find(
      (r) =>
        r.kind === 'spend' &&
        r.decision === 'rejected' &&
        r.receipt_hash === failResult.receipt.receipt_hash,
    );
    if (!rejectedReceipt) await sleep(500);
  }
  assert(rejectedReceipt !== undefined, 'no rejected spend receipt visible in explorer feed');
  ok(
    `rejected receipt visible: ${rejectedReceipt.receipt_hash.slice(0, 16)}… reason=${rejectedReceipt.reason ?? '(none)'}`,
  );
  // Sanity: the in-memory onReceipt callback should have fired with the same hash.
  assert(
    failReceipt?.receipt_hash === failResult.receipt.receipt_hash,
    'onReceipt did not fire for the rejected pass',
  );
  // ───── 16. counters bumped on the link ─────
  step('GET /v1/payment-links/{id} — counters bumped');
  // Counters update inside the paywall handler; give it a moment.
  let bumped = await api<{
    counters: { call_count: number; settled_count: number; last_tx_sig: string | null };
  }>(`/v1/payment-links/${linkId}`);
  for (let i = 0; i < 8 && bumped.counters.settled_count === 0; i += 1) {
    await sleep(500);
    bumped = await api(`/v1/payment-links/${linkId}`);
  }
  assert(bumped.counters.settled_count >= 1, 'settled_count never bumped');
  // The USDG settlement (when it ran) overwrites `last_tx_sig` with its own
  // signature, so accept either the USDC or USDG tx as the last_tx_sig.
  const validLastTxSigs = [callResult.receipt.tx_sig, usdgTxSig].filter(Boolean) as string[];
  assert(
    bumped.counters.last_tx_sig != null && validLastTxSigs.includes(bumped.counters.last_tx_sig),
    `last_tx_sig (${bumped.counters.last_tx_sig}) should match one of ${validLastTxSigs.join(', ')}`,
  );
  ok(
    `call_count=${bumped.counters.call_count}, settled_count=${bumped.counters.settled_count}, last_tx_sig=${bumped.counters.last_tx_sig}`,
  );

  // ───── 17. events present in the feed ─────
  step('GET /v1/events?kind=payment_link.settled — settlement event');
  const settledEvents = await api<{
    items: Array<{ kind: string; signature: string | null; metadata: Record<string, unknown> }>;
  }>(`/v1/events?kind=payment_link.settled&agent=${sellerAgent}&limit=5`);
  const matching = settledEvents.items.find(
    (e) => (e.metadata?.tx_sig as string | undefined) === callResult.receipt.tx_sig,
  );
  assert(matching !== undefined, 'no payment_link.settled event with this tx_sig');
  ok(`payment_link.settled event found (metadata.tx_sig=${matching.metadata.tx_sig})`);

  step('GET /v1/events?kind=receipt.published — earn receipt event');
  const receiptEvents = await api<{
    items: Array<{ kind: string; metadata: Record<string, unknown> }>;
  }>(`/v1/events?kind=receipt.published&agent=${sellerAgent}&limit=5`);
  const matchingReceipt = receiptEvents.items.find(
    (e) => (e.metadata?.tx_sig as string | undefined) === callResult.receipt.tx_sig,
  );
  assert(matchingReceipt !== undefined, 'no receipt.published event for our tx_sig');
  ok(`receipt.published event matched (metadata.tx_sig=${matchingReceipt.metadata.tx_sig})`);

  // ───── 18. receipts visible in the per-agent feed ─────
  step('GET /v1/receipts/{seller} — earn receipt visible');
  const receipts = await api<{
    items: Array<{ kind: string; tx_sig: string | null; receipt_hash: string }>;
  }>(`/v1/receipts/${sellerAgent}?limit=5`);
  const earnReceipt = receipts.items.find(
    (r) => r.kind === 'earn' && r.tx_sig === callResult.receipt.tx_sig,
  );
  assert(earnReceipt !== undefined, 'no earn receipt with our tx_sig');
  ok(`earn receipt: ${earnReceipt.receipt_hash.slice(0, 16)}… tx=${earnReceipt.tx_sig}`);

  step('GET /v1/receipts/{buyer} — spend receipt visible');
  // onReceipt above is async, give the POST a moment to land before reading.
  let spendReceipt: { kind: string; tx_sig: string | null; receipt_hash: string } | undefined;
  for (let i = 0; i < 10 && spendReceipt === undefined; i += 1) {
    const buyerReceipts = await api<{
      items: Array<{ kind: string; tx_sig: string | null; receipt_hash: string }>;
    }>(`/v1/receipts/${buyerAgent}?limit=5`);
    spendReceipt = buyerReceipts.items.find(
      (r) => r.kind === 'spend' && r.tx_sig === callResult.receipt.tx_sig,
    );
    if (!spendReceipt) await sleep(500);
  }
  assert(spendReceipt !== undefined, 'no spend receipt with our tx_sig');
  ok(`spend receipt: ${spendReceipt.receipt_hash.slice(0, 16)}… tx=${spendReceipt.tx_sig}`);

  // ───── 19. by-hash lookup is stable ─────
  step('GET /v1/receipts/by-hash/{hash} — direct lookup');
  const byHash = await api<{ receipt_hash: string; tx_sig: string | null; kind: string }>(
    `/v1/receipts/by-hash/${earnReceipt.receipt_hash}`,
  );
  assert(byHash.receipt_hash === earnReceipt.receipt_hash, 'by-hash lookup mismatch');
  ok(`by-hash lookup OK (kind=${byHash.kind}, tx=${byHash.tx_sig})`);

  // ───── 19b. optional hosted MPP paywall (same buyer + delegation) ─────
  if (process.env.LEASH_E2E_MPP === '1') {
    step('POST /v1/payment-links — create MPP hosted paywall');
    const mppLink = await api<{
      id: string;
      share_url: string;
      protocol?: string;
    }>('/v1/payment-links', {
      method: 'POST',
      body: {
        label: `e2e-mpp-${Date.now()}`,
        owner_agent: sellerAgent,
        method: 'GET',
        price: PRICE,
        currency: 'USDC',
        protocol: 'mpp',
        response: {
          status: 200,
          mimeType: 'application/json',
          body: { ok: true, message: 'paid via mpp e2e' },
        },
        metadata: { source: 'apps/api/scripts/e2e-devnet.ts', suite: 'mpp' },
      },
    });
    mppLinkId = mppLink.id;
    ok(`MPP payment link id: ${mppLink.id}`);

    step('GET /x/{mppId} — anonymous probe returns 402 problem+json');
    const mppShareUrl = mppLink.share_url;
    const mppProbe = await fetch(`${mppShareUrl}?network=solana-devnet`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    assert(
      mppProbe.status === 402,
      `MPP paywall should 402 for unpaid probe, got ${mppProbe.status}`,
    );
    const mppCt = mppProbe.headers.get('content-type') ?? '';
    assert(
      mppCt.toLowerCase().includes('problem+json'),
      `MPP 402 should be application/problem+json, got ${mppCt}`,
    );
    const mppProbeJson = (await mppProbe.json()) as { type?: string; challengeId?: string };
    assert(
      typeof mppProbeJson.type === 'string' && mppProbeJson.type.length > 0,
      'MPP body missing type',
    );
    assert(
      typeof mppProbeJson.challengeId === 'string' && mppProbeJson.challengeId.length > 4,
      'MPP body missing challengeId',
    );
    ok(`MPP 402 challenge id: ${mppProbeJson.challengeId.slice(0, 12)}…`);

    step('createBuyer.fetch(mpp share_url) — real MPP settlement on devnet');
    const mppResult = await buyer.fetch(`${mppShareUrl}?network=solana-devnet`, {
      method: 'GET',
    });
    if (!isReceiptV02(mppResult.receipt) || mppResult.receipt.protocol !== 'mpp') {
      const got = isReceiptV02(mppResult.receipt) ? mppResult.receipt.protocol : 'not ReceiptV02';
      fatal(`expected ReceiptV02 with protocol mpp, got: ${got}`);
    }
    const mppSpend = mppResult.receipt;
    const mppSig = mppSpend.mpp_settlement_tx || mppSpend.tx_sig;
    if (!mppSig || mppSig.length < 8) {
      fatal(
        `MPP settlement failed; failureReason=${mppResult.failureReason ?? '(none)'} decision=${mppSpend.decision}`,
      );
    }
    assert(
      mppResult.response.status === 200,
      `MPP retry should 200, got ${mppResult.response.status}`,
    );
    ok(`MPP settled — tx_sig: ${mppSig}`);

    await sleep(2_000);
    step('GET /v1/receipts/{buyer} — MPP spend receipt visible');
    let mppSpendRow: { kind: string; tx_sig: string | null; receipt_hash: string } | undefined;
    for (let i = 0; i < 10 && mppSpendRow === undefined; i += 1) {
      const feed = await api<{
        items: Array<{ kind: string; tx_sig: string | null; receipt_hash: string }>;
      }>(`/v1/receipts/${buyerAgent}?limit=8`);
      mppSpendRow = feed.items.find((r) => r.kind === 'spend' && r.tx_sig === mppSig);
      if (!mppSpendRow) await sleep(500);
    }
    assert(mppSpendRow !== undefined, 'no spend receipt row for MPP settlement sig');
    ok(`MPP spend receipt hash: ${mppSpendRow.receipt_hash.slice(0, 16)}…`);
  }

  // ───── 20. indexer status is healthy ─────
  step('GET /v1/indexer/status — explorer power source');
  const status = await api<{
    network: string;
    watchlist_size: number;
    cursors: { total: number; last_run_at: string | null };
    events_last_hour: Record<string, number>;
  }>('/v1/indexer/status');
  assert(status.network === 'solana-devnet', `expected devnet, got ${status.network}`);
  assert(status.watchlist_size >= 1, 'watchlist should include at least the seller agent');
  const settledLastHour = status.events_last_hour['payment_link.settled'] ?? 0;
  assert(settledLastHour >= 1, 'no payment_link.settled events in the last hour');
  ok(
    `indexer healthy — watchlist=${status.watchlist_size}, cursors=${status.cursors.total}, settled (1h)=${settledLastHour}`,
  );

  // ───── 21. cleanup (soft) ─────
  if (KEEP_LINK) {
    step('Cleanup skipped (LEASH_E2E_KEEP_LINK=1)');
    info(`probe the success link in the explorer: /payment-links/${linkId}`);
    info(`probe the failure link in the explorer: /payment-links/${failLink.id}`);
  } else {
    step('PATCH /v1/payment-links/{id} — soft-disable for cleanup');
    await api(`/v1/payment-links/${linkId}`, { method: 'PATCH', body: { disabled: true } });
    await api(`/v1/payment-links/${failLink.id}`, { method: 'PATCH', body: { disabled: true } });
    if (mppLinkId) {
      await api(`/v1/payment-links/${mppLinkId}`, { method: 'PATCH', body: { disabled: true } });
    }
    ok('payment links disabled (set LEASH_E2E_KEEP_LINK=1 to skip)');
  }

  console.log('\n============================================================');
  console.log('✓ end-to-end devnet run completed');
  console.log('============================================================');
  console.log(`payment link  : ${shareUrl}`);
  console.log(`tx signature  : https://solscan.io/tx/${callResult.receipt.tx_sig}?cluster=devnet`);
  if (usdgTxSig) {
    console.log(`usdg tx sig   : https://solscan.io/tx/${usdgTxSig}?cluster=devnet`);
  }
  console.log(`fail link     : ${failLink.share_url}`);
  console.log(`fail receipt  : ${failResult.receipt.receipt_hash} (decision=rejected)`);
  console.log(`seller agent  : ${sellerAgent}`);
  console.log(`buyer  agent  : ${buyerAgent}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function ensureAgent(
  umi: Umi,
  ownerPubkey: string,
  label: 'seller' | 'buyer',
  reuseAsset: string | undefined,
): Promise<string> {
  if (reuseAsset && reuseAsset.length > 0) {
    info(`reusing ${label} agent from env: ${reuseAsset}`);
    return reuseAsset;
  }
  info(`minting fresh ${label} agent (this submits a real on-chain tx)…`);
  const result = await createAgent(umi, {
    wallet: ownerPubkey,
    network: 'solana-devnet',
    name: `leash-e2e-${label}-${Date.now()}`,
    description: `Auto-minted by apps/api/scripts/e2e-devnet.ts (${label})`,
    uri: AGENT_URI,
  });
  info(`mint sig: ${result.signature}`);
  await sleep(2_000);
  return result.assetAddress;
}

async function pollDelegation(
  umi: Umi,
  buyerAgent: string,
  predicate: (s: Awaited<ReturnType<typeof getSpendDelegation>>) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<Awaited<ReturnType<typeof getSpendDelegation>>> {
  const started = Date.now();
  let backoff = 750;
  let last = await getSpendDelegation(umi, { agentAsset: buyerAgent, mint: USDC_MINT });
  while (!predicate(last)) {
    if (Date.now() - started > timeoutMs) {
      fatal(
        `${label}: predicate never satisfied within ${timeoutMs}ms — last=${JSON.stringify({ delegate: last.delegate, balance: last.balance.toString(), delegatedAmount: last.delegatedAmount.toString() })}`,
      );
    }
    await sleep(backoff);
    backoff = Math.min(Math.floor(backoff * 1.5), 4_000);
    last = await getSpendDelegation(umi, { agentAsset: buyerAgent, mint: USDC_MINT });
  }
  return last;
}

async function pollDelegationMint(
  umi: Umi,
  buyerAgent: string,
  mint: string,
  tokenProgram: PublicKey,
  predicate: (s: Awaited<ReturnType<typeof getSpendDelegation>>) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<Awaited<ReturnType<typeof getSpendDelegation>>> {
  const started = Date.now();
  let backoff = 750;
  let last = await getSpendDelegation(umi, { agentAsset: buyerAgent, mint, tokenProgram });
  while (!predicate(last)) {
    if (Date.now() - started > timeoutMs) {
      fatal(
        `${label}: predicate never satisfied within ${timeoutMs}ms — last=${JSON.stringify({ delegate: last.delegate, balance: last.balance.toString(), delegatedAmount: last.delegatedAmount.toString() })}`,
      );
    }
    await sleep(backoff);
    backoff = Math.min(Math.floor(backoff * 1.5), 4_000);
    last = await getSpendDelegation(umi, { agentAsset: buyerAgent, mint, tokenProgram });
  }
  return last;
}

async function ensureOwnerHasUsdc(umi: Umi, owner: string, need: bigint): Promise<void> {
  const [ataPda] = findAssociatedTokenPda(umi, {
    mint: publicKey(USDC_MINT),
    owner: publicKey(owner),
  });
  try {
    const token = await fetchToken(umi, ataPda);
    if (token.amount >= need) return;
    fatal(
      `owner ${owner} USDC balance (${token.amount}) < required (${need}). ` +
        `Top up owner via https://faucet.circle.com or set LEASH_E2E_FUND_USDC lower.`,
    );
  } catch {
    // Owner ATA missing entirely — create it (zero balance), then fail loudly.
    await createTokenIfMissing(umi, {
      mint: publicKey(USDC_MINT),
      owner: publicKey(owner),
    }).sendAndConfirm(umi);
    fatal(
      `owner ${owner} had no USDC ATA. Created a fresh empty one — please ` +
        `fund it with at least ${need} atomic units of USDC and rerun.`,
    );
  }
}

async function transferOwnerUsdcTo(
  umi: Umi,
  owner: string,
  destAta: string,
  amount: bigint,
): Promise<string> {
  const [sourceAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(USDC_MINT),
    owner: publicKey(owner),
  });
  info(`transfer source     : ${String(sourceAta)} (owner=${owner})`);
  info(`transfer destination: ${destAta}`);
  info(`transfer amount     : ${amount.toString()} (atomic, decimals=6)`);
  const builder = transferTokens(umi, {
    source: sourceAta,
    destination: publicKey(destAta),
    amount,
    authority: umi.identity,
  });
  const res = await builder.sendAndConfirm(umi);
  return base58.deserialize(res.signature)[0];
}

/**
 * Owner-driven Token-2022 `TransferChecked` (discriminator 12). Used to
 * fund the buyer treasury USDG ATA from the owner's wallet — `mpl-toolbox`'s
 * `transferTokens` only targets the classic SPL Token program, and Token-2022
 * mints with extensions (USDG has a transfer hook) reject the legacy
 * `Transfer` discriminator. We hand-build the instruction so we can target
 * `TOKEN_2022_PROGRAM_ID` explicitly and supply the `decimals` byte the
 * runtime cross-checks against the mint.
 */
async function transferOwnerToken2022To(
  umi: Umi,
  args: {
    mint: string;
    owner: string;
    destAta: string;
    amount: bigint;
    decimals: number;
    tokenProgram: PublicKey;
  },
): Promise<string> {
  const [sourceAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(args.mint),
    owner: publicKey(args.owner),
    tokenProgramId: args.tokenProgram,
  });
  info(`transfer source     : ${String(sourceAta)} (owner=${args.owner}, token-2022)`);
  info(`transfer destination: ${args.destAta}`);
  info(`transfer amount     : ${args.amount.toString()} (atomic, decimals=${args.decimals})`);

  const data = new Uint8Array(1 + 8 + 1);
  data[0] = 12; // SPL Token TransferChecked discriminator
  new DataView(data.buffer).setBigUint64(1, args.amount, true);
  data[9] = args.decimals & 0xff;

  const ix: Instruction = {
    programId: args.tokenProgram,
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: publicKey(args.mint), isSigner: false, isWritable: false },
      { pubkey: publicKey(args.destAta), isSigner: false, isWritable: true },
      { pubkey: umi.identity.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  };

  const builder = transactionBuilder().add({
    instruction: ix,
    signers: [umi.identity],
    bytesCreatedOnChain: 0,
  });
  const res = await builder.sendAndConfirm(umi);
  return base58.deserialize(res.signature)[0];
}

/**
 * Read SPL Token mint `decimals` byte (works for both classic Token and
 * Token-2022; the layout is identical for the first 45 bytes).
 */
async function readMintDecimals(umi: Umi, mint: string): Promise<number> {
  const account = await umi.rpc.getAccount(publicKey(mint));
  if (!account.exists) {
    throw new Error(`mint ${mint} does not exist on this RPC`);
  }
  if (account.data.length < 45) {
    throw new Error(`mint ${mint} has unexpected data length ${account.data.length} (<45)`);
  }
  return account.data[44] ?? 0;
}

/**
 * Ensure the buyer treasury USDG ATA is funded with at least `need` atomic
 * units, transferred from `owner`'s USDG ATA. The destination ATA was
 * already created by `provisionTreasuryAtas` upstream, so this only handles
 * the transfer. Returns `{ funded: false, reason }` when the owner doesn't
 * hold enough USDG so the caller can decide to skip the USDG settlement
 * pass instead of aborting the whole run.
 */
async function ensureBuyerHasUsdg(
  umi: Umi,
  args: {
    owner: string;
    destAta: string;
    need: bigint;
  },
): Promise<{ funded: boolean; reason?: string }> {
  const [ownerAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(USDG_MINT),
    owner: publicKey(args.owner),
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
  });
  const ownerAcct = await umi.rpc.getAccount(ownerAta);
  if (!ownerAcct.exists) {
    return {
      funded: false,
      reason: `owner ${args.owner} has no USDG ATA (${String(ownerAta)}). Fund it via faucet.solana.com first.`,
    };
  }
  if (ownerAcct.data.length < 72) {
    return {
      funded: false,
      reason: `owner USDG ATA has unexpected length ${ownerAcct.data.length}`,
    };
  }
  const dv = new DataView(
    ownerAcct.data.buffer,
    ownerAcct.data.byteOffset,
    ownerAcct.data.byteLength,
  );
  const ownerBalance = dv.getBigUint64(64, true);
  if (ownerBalance < args.need) {
    return {
      funded: false,
      reason: `owner USDG balance (${ownerBalance}) < required (${args.need}). Fund ${args.owner} (ATA ${String(ownerAta)}) and rerun.`,
    };
  }

  const decimals = await readMintDecimals(umi, USDG_MINT);
  const sig = await transferOwnerToken2022To(umi, {
    mint: USDG_MINT,
    owner: args.owner,
    destAta: args.destAta,
    amount: args.need,
    decimals,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  ok(`USDG top-up tx: ${sig}`);
  return { funded: true };
}

main().catch((err) => {
  console.error('\n✗ unhandled error');
  console.error(err);
  process.exit(1);
});
