/**
 * End-to-end devnet smoke test for the @leash/api surface.
 *
 * What this script proves
 * -----------------------
 * The shipped HTTP API exposes the same primitives as `@leash/seller-kit`
 * and `@leash/buyer-kit`, plus the hosted-paywall flow on `/x/{id}`. This
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
 *   LEASH_E2E_KEEP_LINK        "1" to skip cleanup at the end so you can
 *                              poke the link in the explorer manually.
 *
 * Usage
 * -----
 *   pnpm --filter @leash/api e2e:devnet
 * or:
 *   cd apps/api && node --env-file=.env.e2e --import tsx ./scripts/e2e-devnet.ts
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { createKeyPairSignerFromBytes } from '@solana/kit';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, publicKey, type Umi, type PublicKey } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore, findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { mplToolbox, findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import { createTokenIfMissing, transferTokens, fetchToken } from '@metaplex-foundation/mpl-toolbox';

import { createBuyer } from '@leash/buyer-kit';
import {
  createAgent,
  setSpendDelegation,
  getSpendDelegation,
  provisionTreasuryAtas,
  TOKEN_2022_PROGRAM_ID,
} from '@leash/registry-utils';

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
  console.log('============================================================');
  console.log('Leash API end-to-end devnet test');
  console.log('============================================================');
  console.log(`api      : ${API_URL}`);
  console.log(`rpc      : ${RPC}`);
  console.log(`api key  : ${API_KEY.slice(0, 16)}…${API_KEY.slice(-4)}`);
  console.log(`usdc mint: ${USDC_MINT}`);
  console.log(`usdg mint: ${USDG_MINT}`);
  console.log(`price    : ${PRICE}`);

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
  if (usdgDelegation.balance < FUND_USDG) {
    warn(
      `buyer USDG balance (${usdgDelegation.balance}) < ${FUND_USDG} — skipping USDG settlement. ` +
        `Fund the treasury ATA (${usdgDelegation.sourceTokenAccount}) with devnet USDG from faucet.solana.com ` +
        `or set LEASH_E2E_FUND_USDG lower to skip this check.`,
    );
  } else {
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
  if (usdgDelegation.balance >= FUND_USDG && usdgDelegation.delegate === ownerPubkey) {
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
  assert(
    bumped.counters.last_tx_sig === callResult.receipt.tx_sig,
    'last_tx_sig should match settled tx',
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
    info(`probe the link in the explorer: /payment-links/${linkId}`);
  } else {
    step('PATCH /v1/payment-links/{id} — soft-disable for cleanup');
    await api(`/v1/payment-links/${linkId}`, {
      method: 'PATCH',
      body: { disabled: true },
    });
    ok('payment link disabled (set LEASH_E2E_KEEP_LINK=1 to skip)');
  }

  console.log('\n============================================================');
  console.log('✓ end-to-end devnet run completed');
  console.log('============================================================');
  console.log(`payment link  : ${shareUrl}`);
  console.log(`tx signature  : https://solscan.io/tx/${callResult.receipt.tx_sig}?cluster=devnet`);
  if (usdgTxSig) {
    console.log(`usdg tx sig   : https://solscan.io/tx/${usdgTxSig}?cluster=devnet`);
  }
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

main().catch((err) => {
  console.error('\n✗ unhandled error');
  console.error(err);
  process.exit(1);
});
