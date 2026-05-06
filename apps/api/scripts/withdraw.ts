/**
 * One-shot withdrawal script — drives the public Leash API surface.
 *
 * Goal: withdraw `LEASH_WITHDRAW_AMOUNT` USDG (default `99`, in display
 * units) from the agent treasury identified by `LEASH_WITHDRAW_AGENT`
 * (default `E1wVJPjADFMmdpJ2T3To9C9sBD97PCcPaxPFFqmka6rv`) to the
 * destination wallet identified by `LEASH_WITHDRAW_DESTINATION`
 * (default: the public key derived from the owner secret).
 *
 * Path exercised end-to-end:
 *   1. Resolve owner pubkey + USDG mint metadata.
 *   2. (Optional) Top up the treasury USDG balance from the owner ATA
 *      if it's below the requested amount, using a vanilla SPL transfer
 *      via Umi. Owner USDG ATA is auto-created via `createTokenIfMissing`
 *      if it doesn't exist; if the owner has no USDG balance, fail loudly
 *      with faucet instructions.
 *   3. POST `/v1/agents/{agent}/treasury/withdraw/prepare` with
 *      `spl_mint` = USDG, `amount` = N atomic, `destination` = owner,
 *      `token_program` = `token-2022` (USDG is a Token-2022 mint).
 *   4. Sign the returned transaction with the owner secret.
 *   5. POST `/v1/submit` with `{ event_id, transaction_base64 }`.
 *   6. Poll `/v1/events/{event_id}` until `phase=confirmed` (or `failed`).
 *   7. Print the Solscan URL and a final balance readout.
 *
 * The script reuses `apps/api/.env` + `apps/api/.env.e2e` so callers
 * that already configured the e2e suite have nothing extra to set up.
 *
 * Usage
 * -----
 *   pnpm --filter @leashmarket/api withdraw
 * or:
 *   cd apps/api && node \
 *     --env-file-if-exists=.env --env-file-if-exists=.env.e2e \
 *     --import tsx ./scripts/withdraw.ts
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

import { getTreasuryBalance, TOKEN_2022_PROGRAM_ID } from '@leashmarket/registry-utils';

import {
  signWireTransaction,
  waitForEvent,
  type EventRow,
  type PreparedResponse,
  type SubmitResponse,
} from './lib/api-prepare-submit.js';

// Devnet USDG (Global Dollar by Paxos) — Token-2022 mint, 6 decimals.
// Mirrors `KNOWN_TOKENS` in `@leashmarket/core/tokens` so this script keeps
// working even if the API isn't reachable for token metadata lookups.
const DEVNET_USDG_MINT = '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7';
const USDG_DECIMALS = 6;

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const API_URL = (process.env.LEASH_E2E_API_URL ?? 'http://localhost:8801').replace(/\/+$/, '');
const API_KEY = required('LEASH_E2E_API_KEY');
const OWNER_SECRET = required('LEASH_E2E_OWNER_SECRET');
const RPC = process.env.LEASH_E2E_RPC ?? 'https://api.devnet.solana.com';
const AGENT = process.env.LEASH_WITHDRAW_AGENT ?? 'E1wVJPjADFMmdpJ2T3To9C9sBD97PCcPaxPFFqmka6rv';
const MINT = process.env.LEASH_WITHDRAW_MINT ?? DEVNET_USDG_MINT;
const AMOUNT_DISPLAY = process.env.LEASH_WITHDRAW_AMOUNT ?? '99';

if (!API_KEY.startsWith('lsh_test_')) {
  fatal(`expected a devnet key (lsh_test_*), got "${API_KEY.slice(0, 12)}…"`);
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
  console.log('Leash API one-shot treasury withdraw');
  console.log('============================================================');
  console.log(`api      : ${API_URL}`);
  console.log(`rpc      : ${RPC}`);
  console.log(`agent    : ${AGENT}`);
  console.log(`mint     : ${MINT} (USDG, Token-2022, ${USDG_DECIMALS} decimals)`);
  console.log(`amount   : ${AMOUNT_DISPLAY} USDG`);

  const amountAtomic = displayToAtomic(AMOUNT_DISPLAY, USDG_DECIMALS);
  if (amountAtomic <= 0n) fatal(`amount must be positive, got ${AMOUNT_DISPLAY}`);

  // ───── 1. Health check ─────
  step('GET /v1/health');
  const health = await api<{ ok: boolean }>('/v1/health');
  if (!health.ok) fatal('API health check failed');
  ok(`API is up`);

  // ───── 2. Bootstrap owner wallet + umi ─────
  step('Bootstrap owner wallet + umi');
  const ownerBytes = decodeSecret(OWNER_SECRET);
  const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(ownerBytes)));
  const ownerPubkey = String(umi.identity.publicKey);
  const destination = process.env.LEASH_WITHDRAW_DESTINATION ?? ownerPubkey;
  ok(`owner wallet  : ${ownerPubkey}`);
  ok(`destination   : ${destination}${destination === ownerPubkey ? ' (= owner)' : ''}`);

  // ───── 3. Read current treasury balance + top up if needed ─────
  step('Read treasury USDG balance + top up if below request');
  const treasuryBalance = await getTreasuryBalance(umi, {
    agentAsset: AGENT,
    mint: MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  info(`current treasury balance: ${atomicToDisplay(treasuryBalance, USDG_DECIMALS)} USDG`);

  if (treasuryBalance < amountAtomic) {
    const need = amountAtomic - treasuryBalance;
    info(
      `treasury short by ${atomicToDisplay(need, USDG_DECIMALS)} USDG; topping up from owner ATA…`,
    );
    await ensureOwnerHasUsdg(umi, ownerPubkey, need);
    const topUpSig = await topUpTreasury(umi, ownerPubkey, AGENT, need);
    ok(`top-up tx: ${topUpSig}`);
    // RPC needs a moment to surface the new balance.
    await sleep(2_500);
    const after = await getTreasuryBalance(umi, {
      agentAsset: AGENT,
      mint: MINT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    info(`treasury balance after top-up: ${atomicToDisplay(after, USDG_DECIMALS)} USDG`);
    if (after < amountAtomic) {
      fatal(
        `top-up landed but balance ${atomicToDisplay(after, USDG_DECIMALS)} USDG still < request ${AMOUNT_DISPLAY}`,
      );
    }
  } else {
    ok(`balance already covers request (${atomicToDisplay(treasuryBalance, USDG_DECIMALS)} USDG)`);
  }

  // ───── 4. Prepare withdraw via API ─────
  step('POST /v1/agents/{agent}/treasury/withdraw/prepare');
  const prepared = await api<
    PreparedResponse<{
      treasury: string;
      source_token_account: string;
      destination_token_account: string;
      amount: string;
      destination: string;
      will_create_destination_ata: boolean;
      decimals: number;
    }>
  >(`/v1/agents/${AGENT}/treasury/withdraw/prepare`, {
    method: 'POST',
    body: {
      payer: ownerPubkey,
      authority: ownerPubkey,
      spl_mint: MINT,
      destination,
      amount: amountAtomic.toString(),
      token_program: 'token-2022',
      decimals: USDG_DECIMALS,
      create_destination_ata_if_missing: true,
    },
  });
  ok(`event_id           : ${prepared.event_id}`);
  ok(`treasury           : ${prepared.echo.treasury}`);
  ok(`source ATA (debit) : ${prepared.echo.source_token_account}`);
  ok(`destination ATA    : ${prepared.echo.destination_token_account}`);
  if (prepared.echo.will_create_destination_ata) {
    info('destination ATA missing — bundle will prepend a CreateIdempotent.');
  }

  // ───── 5. Sign + submit ─────
  step('Sign with owner key + POST /v1/submit');
  const signed = await signWireTransaction(umi, prepared.transaction, [umi.identity]);
  const submitted = await api<SubmitResponse>('/v1/submit', {
    method: 'POST',
    body: { event_id: prepared.event_id, transaction_base64: signed },
  });
  ok(`signature : ${submitted.signature}`);
  ok(`phase     : ${submitted.phase}`);

  // ───── 6. Wait for confirmation ─────
  step('Poll /v1/events/{event_id} until terminal phase');
  const final = await waitForEvent((id) => api<EventRow>(`/v1/events/${id}`), prepared.event_id, {
    timeoutMs: 90_000,
    intervalMs: 1_500,
  });
  if (final.phase !== 'confirmed') {
    fatal(
      `withdraw did not confirm — phase=${final.phase}, error_code=${final.error_code ?? 'n/a'}, logs=${final.error_logs ?? 'n/a'}`,
    );
  }
  ok(`confirmed at slot/time ${final.block_time ?? '(unknown)'}`);

  // ───── 7. Final balance readout ─────
  step('Final treasury USDG balance');
  await sleep(1_500);
  const finalBalance = await getTreasuryBalance(umi, {
    agentAsset: AGENT,
    mint: MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  info(`treasury balance: ${atomicToDisplay(finalBalance, USDG_DECIMALS)} USDG`);

  console.log('\n============================================================');
  console.log('✓ withdraw completed');
  console.log('============================================================');
  console.log(`agent       : ${AGENT}`);
  console.log(`destination : ${destination}`);
  console.log(`amount      : ${AMOUNT_DISPLAY} USDG`);
  console.log(`signature   : https://solscan.io/tx/${submitted.signature}?cluster=devnet`);
  console.log(`event_id    : ${prepared.event_id}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers — local USDG funding, treasury top-up.
// ────────────────────────────────────────────────────────────────────────────

async function ensureOwnerHasUsdg(umi: Umi, owner: string, need: bigint): Promise<void> {
  const [ataPda] = findAssociatedTokenPda(umi, {
    mint: publicKey(MINT),
    owner: publicKey(owner),
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
  });
  try {
    const token = await fetchToken(umi, ataPda);
    if (token.amount >= need) return;
    fatal(
      `owner ${owner} USDG balance (${atomicToDisplay(token.amount, USDG_DECIMALS)}) < required (${atomicToDisplay(need, USDG_DECIMALS)} USDG). ` +
        `Mint USDG to the owner wallet via the project's USDG faucet, then re-run.`,
    );
  } catch {
    // Owner ATA missing entirely — create the empty ATA, then bail with
    // an actionable error message. Token-2022 ATAs MUST be created via
    // the Token-2022 program; calling `createTokenIfMissing` without
    // passing `tokenProgram` would default to classic SPL Token and
    // emit `IncorrectProgramId`.
    await createTokenIfMissing(umi, {
      mint: publicKey(MINT),
      owner: publicKey(owner),
      ata: ataPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).sendAndConfirm(umi);
    fatal(
      `owner ${owner} had no USDG ATA. Created a fresh empty Token-2022 ATA — ` +
        `please fund it with at least ${atomicToDisplay(need, USDG_DECIMALS)} USDG and re-run.`,
    );
  }
}

async function topUpTreasury(
  umi: Umi,
  owner: string,
  agent: string,
  amount: bigint,
): Promise<string> {
  const [sourceAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(MINT),
    owner: publicKey(owner),
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
  });
  // The treasury's USDG ATA is owned by the agent's Asset Signer PDA.
  // Derive it manually and `createTokenIfMissing` so the destination
  // exists before we transfer funds in.
  const [treasuryPda] = findAssetSignerPda(umi, { asset: publicKey(agent) });
  const [destAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(MINT),
    owner: treasuryPda,
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
  });
  const destAcct = await umi.rpc.getAccount(destAta);
  if (!destAcct.exists) {
    info(`treasury USDG ATA missing — creating at ${String(destAta)}`);
    await createTokenIfMissing(umi, {
      mint: publicKey(MINT),
      owner: treasuryPda,
      ata: destAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).sendAndConfirm(umi);
  }
  info(`top-up source : ${String(sourceAta)} (owner=${owner})`);
  info(`top-up dest   : ${String(destAta)} (treasury=${String(treasuryPda)})`);
  info(`top-up amount : ${amount.toString()} atomic`);
  // mpl-toolbox's `transferTokensChecked` hard-routes through the
  // classic SPL Token program. USDG is Token-2022, so build the
  // `TransferChecked` instruction by hand against the right program id —
  // same encoding `registry-utils/src/withdraw.ts` uses internally.
  const transferIx = buildTransferCheckedIx({
    source: sourceAta,
    mint: publicKey(MINT),
    destination: destAta,
    authority: publicKey(owner),
    amount,
    decimals: USDG_DECIMALS,
    programId: TOKEN_2022_PROGRAM_ID,
  });
  const builder = transactionBuilder().add({
    instruction: transferIx,
    signers: [umi.identity],
    bytesCreatedOnChain: 0,
  });
  const res = await builder.sendAndConfirm(umi);
  return base58.deserialize(res.signature)[0];
}

/**
 * SPL Token classic discriminator: 12 = TransferChecked. Layout matches
 * both the legacy SPL Token and Token-2022 programs (Token-2022 simply
 * re-uses the classic instruction set).
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
