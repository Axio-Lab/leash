/**
 * One-shot funding script — deposits SPL tokens into an agent treasury
 * so the explorer's `agent.treasury.fund` feed has fresh, real data.
 *
 * Why no `prepare/submit` round-trip? Deposits are plain SPL
 * `TransferChecked` instructions — anyone with tokens can send to the
 * treasury PDA's ATA. There's no PDA-side authority to satisfy and
 * therefore no API endpoint to "prepare" a deposit; the API instead
 * learns about deposits *after the fact* via the chain indexer
 * (which watches each registered ATA and emits
 * `agent.treasury.fund` rows).
 *
 * What this script does end-to-end:
 *
 *   1. Resolves the owner wallet, the agent's treasury PDA, and the
 *      treasury's ATA for the chosen mint (creates the ATA via
 *      `createTokenIfMissing` if needed). USDG → Token-2022 program;
 *      everything else → classic SPL Token.
 *   2. Verifies the owner has enough of the target mint, asking them
 *      to top up via the corresponding faucet otherwise.
 *   3. Builds + sends a `TransferChecked` from the owner ATA into the
 *      treasury ATA, hand-rolled so it works with both program ids.
 *   4. Calls `GET /v1/agents/{mint}/treasury/balances` once — that
 *      endpoint auto-registers the treasury PDA + every ATA it sees,
 *      so the indexer is guaranteed to be watching the deposit before
 *      we start polling.
 *   5. Polls `GET /v1/events?kind=agent.treasury.fund&signature=...`
 *      until the indexer surfaces the deposit (or we time out).
 *   6. Prints the Solscan URL + final treasury balance readout.
 *
 * The script reuses `apps/api/.env` + `apps/api/.env.e2e` so callers
 * that already configured the e2e suite have nothing extra to set up.
 *
 * Usage
 * -----
 *   pnpm --filter @leashmarket/api fund
 * or:
 *   cd apps/api && node \
 *     --env-file-if-exists=.env --env-file-if-exists=.env.e2e \
 *     --import tsx ./scripts/fund.ts
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  keypairIdentity,
  publicKey,
  transactionBuilder,
  type Instruction,
  type PublicKey,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore, findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import {
  mplToolbox,
  findAssociatedTokenPda,
  createTokenIfMissing,
  fetchToken,
} from '@metaplex-foundation/mpl-toolbox';

import {
  getTreasuryBalance,
  TOKEN_2022_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
} from '@leashmarket/registry-utils';

// ────────────────────────────────────────────────────────────────────────────
// Token catalog
// ────────────────────────────────────────────────────────────────────────────

type TokenSpec = {
  symbol: string;
  mint: string;
  decimals: number;
  programId: PublicKey;
  faucet?: string;
};

// Devnet-only catalog. The script is a devnet-only convenience and the
// API key check below enforces that, so we don't need mainnet rows.
const TOKENS: Record<string, TokenSpec> = {
  USDG: {
    symbol: 'USDG',
    mint: '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7',
    decimals: 6,
    programId: TOKEN_2022_PROGRAM_ID,
    faucet: 'https://faucet.global-dollar.com',
  },
  USDC: {
    symbol: 'USDC',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
    programId: SPL_TOKEN_PROGRAM_ID,
    faucet: 'https://faucet.circle.com',
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const API_URL = (process.env.LEASH_E2E_API_URL ?? 'http://localhost:8801').replace(/\/+$/, '');
const API_KEY = required('LEASH_E2E_API_KEY');
const OWNER_SECRET = required('LEASH_E2E_OWNER_SECRET');
const RPC = process.env.LEASH_E2E_RPC ?? 'https://api.devnet.solana.com';
const AGENT = process.env.LEASH_FUND_AGENT ?? 'E1wVJPjADFMmdpJ2T3To9C9sBD97PCcPaxPFFqmka6rv';

const SYMBOL_INPUT = (process.env.LEASH_FUND_SYMBOL ?? 'USDG').toUpperCase();
const TOKEN = resolveToken();
const AMOUNT_DISPLAY = process.env.LEASH_FUND_AMOUNT ?? '100';

if (!API_KEY.startsWith('lsh_test_')) {
  fatal(`expected a devnet key (lsh_test_*), got "${API_KEY.slice(0, 12)}…"`);
}

function resolveToken(): TokenSpec {
  // Explicit mint always wins so users can fund any arbitrary SPL/Token-2022
  // mint without us having to ship an exhaustive registry.
  const overrideMint = process.env.LEASH_FUND_MINT;
  if (overrideMint) {
    const programOverride = process.env.LEASH_FUND_TOKEN_PROGRAM;
    const decimalsRaw = process.env.LEASH_FUND_DECIMALS;
    const decimals = decimalsRaw ? Number(decimalsRaw) : 6;
    if (!Number.isFinite(decimals) || decimals < 0 || decimals > 18) {
      fatal(`LEASH_FUND_DECIMALS=${decimalsRaw} must be an integer in [0,18]`);
    }
    const programId =
      programOverride === 'token-2022'
        ? TOKEN_2022_PROGRAM_ID
        : programOverride === 'spl' || programOverride === undefined
          ? SPL_TOKEN_PROGRAM_ID
          : (publicKey(programOverride) as PublicKey);
    return {
      symbol: SYMBOL_INPUT || 'TOKEN',
      mint: overrideMint,
      decimals,
      programId,
    };
  }
  const t = TOKENS[SYMBOL_INPUT];
  if (!t) {
    fatal(
      `unknown symbol "${SYMBOL_INPUT}" — supported: ${Object.keys(TOKENS).join(', ')}. ` +
        `Override with LEASH_FUND_MINT, LEASH_FUND_DECIMALS, and LEASH_FUND_TOKEN_PROGRAM=spl|token-2022.`,
    );
  }
  return t;
}

// ────────────────────────────────────────────────────────────────────────────
// Tiny logger / helper utilities
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
function fatal(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}
function required(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) fatal(`missing env ${key}`);
  return v;
}
function decodeSecret(raw: string): Uint8Array {
  const t = raw.trim();
  if (t.startsWith('[')) return Uint8Array.from(JSON.parse(t) as number[]);
  return base58.serialize(t);
}
function displayToAtomic(display: string, decimals: number): bigint {
  const trimmed = display.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    fatal(`amount "${display}" is not a non-negative decimal`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    fatal(`amount "${display}" has more than ${decimals} decimals`);
  }
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}
function atomicToDisplay(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, '0');
  const i = s.length - decimals;
  const whole = s.slice(0, i);
  const frac = s.slice(i).replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

// ────────────────────────────────────────────────────────────────────────────
// API client (read-only — fund itself never goes through the API)
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
  console.log('Leash treasury fund (devnet)');
  console.log('============================================================');
  console.log(`api      : ${API_URL}`);
  console.log(`rpc      : ${RPC}`);
  console.log(`agent    : ${AGENT}`);
  console.log(
    `mint     : ${TOKEN.mint} (${TOKEN.symbol}, ${
      TOKEN.programId === TOKEN_2022_PROGRAM_ID ? 'Token-2022' : 'SPL Token'
    }, ${TOKEN.decimals} decimals)`,
  );
  console.log(`amount   : ${AMOUNT_DISPLAY} ${TOKEN.symbol}`);

  const amountAtomic = displayToAtomic(AMOUNT_DISPLAY, TOKEN.decimals);
  if (amountAtomic <= 0n) fatal(`amount must be positive, got ${AMOUNT_DISPLAY}`);

  // ───── 1. Health check ─────
  step('GET /v1/health');
  const health = await api<{ ok: boolean }>('/v1/health');
  if (!health.ok) fatal('API health check failed');
  ok('API is up');

  // ───── 2. Bootstrap owner wallet + umi ─────
  step('Bootstrap owner wallet + umi');
  const ownerBytes = decodeSecret(OWNER_SECRET);
  const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(ownerBytes)));
  const ownerPubkey = String(umi.identity.publicKey);
  ok(`owner wallet : ${ownerPubkey}`);

  // ───── 3. Resolve treasury + ATAs ─────
  step('Resolve treasury PDA + ATAs');
  const [treasuryPda] = findAssetSignerPda(umi, { asset: publicKey(AGENT) });
  const [sourceAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(TOKEN.mint),
    owner: publicKey(ownerPubkey),
    tokenProgramId: TOKEN.programId,
  });
  const [destAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(TOKEN.mint),
    owner: treasuryPda,
    tokenProgramId: TOKEN.programId,
  });
  ok(`treasury PDA  : ${String(treasuryPda)}`);
  ok(`source ATA    : ${String(sourceAta)}`);
  ok(`treasury ATA  : ${String(destAta)}`);

  // ───── 4. Verify owner balance + ensure ATAs exist ─────
  step(`Owner ${TOKEN.symbol} balance + treasury ATA presence`);
  await ensureOwnerHasBalance(umi, ownerPubkey, sourceAta, amountAtomic);
  ok('owner balance covers requested fund amount');

  const destAcct = await umi.rpc.getAccount(destAta);
  if (!destAcct.exists) {
    info(`treasury ${TOKEN.symbol} ATA missing — creating ${String(destAta)}`);
    await createTokenIfMissing(umi, {
      mint: publicKey(TOKEN.mint),
      owner: treasuryPda,
      ata: destAta,
      tokenProgram: TOKEN.programId,
    }).sendAndConfirm(umi);
    ok('treasury ATA created');
  } else {
    ok('treasury ATA already exists');
  }

  // ───── 5. Snapshot treasury balance before deposit ─────
  step('Read treasury balance before deposit');
  const before = await getTreasuryBalance(umi, {
    agentAsset: AGENT,
    mint: TOKEN.mint,
    tokenProgram: TOKEN.programId,
  });
  info(`treasury balance: ${atomicToDisplay(before, TOKEN.decimals)} ${TOKEN.symbol}`);

  // ───── 6. Send TransferChecked owner ATA → treasury ATA ─────
  step(`Send TransferChecked ${atomicToDisplay(amountAtomic, TOKEN.decimals)} ${TOKEN.symbol}`);
  const transferIx = buildTransferCheckedIx({
    source: sourceAta,
    mint: publicKey(TOKEN.mint),
    destination: destAta,
    authority: publicKey(ownerPubkey),
    amount: amountAtomic,
    decimals: TOKEN.decimals,
    programId: TOKEN.programId,
  });
  const builder = transactionBuilder().add({
    instruction: transferIx,
    signers: [umi.identity],
    bytesCreatedOnChain: 0,
  });
  const res = await builder.sendAndConfirm(umi);
  const signature = base58.deserialize(res.signature)[0];
  ok(`signature : ${signature}`);

  // ───── 7. Nudge the API to register the ATA on the watchlist ─────
  // The /treasury/balances endpoint side-effects `ensureWatched` and
  // `ensureWatchedAta`, which is the same hook the indexer hits on
  // startup. Calling it here guarantees the indexer is watching this
  // ATA *before* we start polling for the fund event — even if this
  // is a brand-new agent the API has never seen.
  step('GET /v1/agents/{agent}/treasury/balances (registers ATAs to indexer watchlist)');
  await api(`/v1/agents/${AGENT}/treasury/balances`);
  ok('treasury PDA + ATAs registered on indexer watchlist');

  // ───── 8. Wait for the indexer to surface the fund event ─────
  step('Poll /v1/events?kind=agent.treasury.fund until indexer picks up the deposit');
  const fund = await waitForFundEvent(signature, { timeoutMs: 90_000, intervalMs: 3_000 });
  if (!fund) {
    fatal(
      `indexer did not surface a fund event for signature ${signature} within 90s — ` +
        `is the indexer worker running? (pnpm --filter @leashmarket/api indexer:dev)`,
    );
  }
  ok(`event_id : ${fund.id}`);
  ok(`phase    : ${fund.phase}`);
  ok(`amount   : ${fund.amount_atomic ?? '(missing)'}`);

  // ───── 9. Final balance readout ─────
  step('Final treasury balance');
  await sleep(1_500);
  const after = await getTreasuryBalance(umi, {
    agentAsset: AGENT,
    mint: TOKEN.mint,
    tokenProgram: TOKEN.programId,
  });
  info(
    `treasury balance: ${atomicToDisplay(before, TOKEN.decimals)} → ${atomicToDisplay(
      after,
      TOKEN.decimals,
    )} ${TOKEN.symbol}`,
  );

  console.log('\n============================================================');
  console.log('✓ fund completed');
  console.log('============================================================');
  console.log(`agent       : ${AGENT}`);
  console.log(`mint        : ${TOKEN.mint} (${TOKEN.symbol})`);
  console.log(`amount      : ${AMOUNT_DISPLAY} ${TOKEN.symbol}`);
  console.log(`signature   : https://solscan.io/tx/${signature}?cluster=devnet`);
  console.log(`event_id    : ${fund.id}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function ensureOwnerHasBalance(
  umi: Umi,
  owner: string,
  sourceAta: PublicKey,
  need: bigint,
): Promise<void> {
  try {
    const token = await fetchToken(umi, sourceAta);
    if (token.amount >= need) return;
    fatal(
      `owner ${owner} ${TOKEN.symbol} balance (${atomicToDisplay(token.amount, TOKEN.decimals)}) ` +
        `< required (${atomicToDisplay(need, TOKEN.decimals)} ${TOKEN.symbol}). ` +
        (TOKEN.faucet
          ? `Top up via ${TOKEN.faucet}, then re-run.`
          : 'Top up the owner wallet, then re-run.'),
    );
  } catch {
    // ATA missing entirely — create it (so the next faucet drop has a
    // landing pad) and bail with an actionable error.
    await createTokenIfMissing(umi, {
      mint: publicKey(TOKEN.mint),
      owner: publicKey(owner),
      ata: sourceAta,
      tokenProgram: TOKEN.programId,
    }).sendAndConfirm(umi);
    fatal(
      `owner ${owner} had no ${TOKEN.symbol} ATA. Created an empty one — please fund it ` +
        (TOKEN.faucet ? `(${TOKEN.faucet})` : '') +
        ` with at least ${atomicToDisplay(need, TOKEN.decimals)} ${TOKEN.symbol} and re-run.`,
    );
  }
}

type EventListItem = {
  id: string;
  kind: string;
  phase: string;
  signature: string | null;
  amount_atomic: string | null;
  mint: string | null;
};

async function waitForFundEvent(
  signature: string,
  opts: { timeoutMs: number; intervalMs: number },
): Promise<EventListItem | null> {
  const started = Date.now();
  while (Date.now() - started < opts.timeoutMs) {
    // Filter by agent + kind on the server, then narrow by signature
    // client-side. There's no signature-keyed event lookup endpoint
    // and adding one just for this script would be overkill — at most
    // a few rows match per agent+kind in the polling window.
    const page = await api<{ items: EventListItem[] }>(
      `/v1/events?kind=agent.treasury.fund&agent=${encodeURIComponent(AGENT)}&limit=50`,
    );
    const match = page.items.find((e) => e.signature === signature);
    if (match) return match;
    await sleep(opts.intervalMs);
  }
  return null;
}

/**
 * SPL Token classic discriminator: 12 = TransferChecked. Layout matches
 * both the legacy SPL Token and Token-2022 programs (Token-2022 simply
 * re-uses the classic instruction set), so the same encoding works for
 * both program ids.
 */
function buildTransferCheckedIx(args: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: bigint;
  decimals: number;
  programId: PublicKey;
}): Instruction {
  const data = new Uint8Array(1 + 8 + 1);
  data[0] = 12;
  if (args.amount < 0n) throw new Error('SPL u64 cannot be negative');
  if (args.amount > 0xffffffffffffffffn) throw new Error('SPL u64 overflow');
  new DataView(data.buffer).setBigUint64(1, args.amount, true);
  data[9] = args.decimals & 0xff;
  return {
    programId: args.programId,
    keys: [
      { pubkey: args.source, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.destination, isSigner: false, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
    ],
    data,
  };
}

main().catch((err) => {
  console.error('\n✗ unhandled error');
  console.error(err);
  process.exit(1);
});
