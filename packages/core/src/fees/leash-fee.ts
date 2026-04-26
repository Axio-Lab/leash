/**
 * Leash protocol fee primitives.
 *
 * Every Leash-flavoured x402 settlement levies a small protocol fee on
 * top of the seller's quoted price. The buyer signs **one** transaction
 * with **two** `TransferChecked` instructions — one to the seller's
 * `payTo` ATA, one to the Leash treasury's ATA on the same mint — so
 * both legs settle atomically (either both transfers land or neither
 * does). The fee leg is funded out of the same source token account as
 * the seller leg.
 *
 * This module is the shared building block:
 *   - {@link LEASH_FEE_BPS_DEFAULT} — 100 bps (1%) by default; overridable
 *     by env at the seller (which advertises the fee in `extra['leash.fee']`)
 *     and at the facilitator (which enforces it on `verify` / `settle`).
 *   - {@link computeFeeAtoms} — `ceilBps(amount, bps)`. Always rounds the
 *     fee **up** so dust never leaks out of the treasury when the buyer
 *     pays a non-divisible price.
 *   - {@link LeashFeeExtra} — wire shape stamped onto `paymentRequirements.extra`
 *     so buyer + facilitator agree on bps, amount, mint authority, and ATA.
 *   - {@link resolveLeashFeeAuthority} — env-driven lookup of the treasury
 *     authority pubkey per network (mainnet / devnet).
 *   - {@link getLeashFeeAtaFor} — derive the treasury's ATA for a given
 *     `(asset, tokenProgram)` pair so seller + facilitator both end up
 *     with the same destination address.
 *
 * Fee math is gross-up:
 *   - Seller quotes `net` (e.g. 1 USDC = 1_000_000 atoms).
 *   - Buyer pays `gross = net + fee` where `fee = ceil(net * bps / 10_000)`.
 *   - At 100 bps: 1 USDC → buyer signs 1.01 USDC; 1.00 USDC lands in seller
 *     ATA, 0.01 USDC lands in treasury ATA.
 *
 * Env vars (read at process boot — never inline a stale value):
 *   - `LEASH_FEE_BPS`              — global default (integer 0..1000). Default 100.
 *   - `LEASH_FEE_ENFORCE`          — `off | warn | enforce`. Default `warn`.
 *   - `LEASH_FEE_ENFORCE_MAINNET`  — per-network override; falls back to LEASH_FEE_ENFORCE.
 *   - `LEASH_FEE_ENFORCE_DEVNET`   — per-network override; falls back to LEASH_FEE_ENFORCE.
 *   - `LEASH_FEE_AUTHORITY_MAINNET`— wallet pubkey that owns the mainnet fee ATAs.
 *   - `LEASH_FEE_AUTHORITY_DEVNET` — wallet pubkey that owns the devnet  fee ATAs.
 *
 * Defaults bake in `3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W` on both
 * clusters so a fresh deploy collects fees out of the box. Override via
 * env to rotate the treasury without code changes.
 */

import { address as toAddress, type Address } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

import type { TokenNetwork } from '../tokens/index.js';

/**
 * Default protocol fee rate in basis points (1 bps = 0.01%). 100 bps = 1%.
 * Used by both the seller-kit (when stamping `extra['leash.fee']`) and
 * the facilitator (when verifying inbound payment payloads). Override
 * per-network via the `LEASH_FEE_BPS` env var on both surfaces.
 */
export const LEASH_FEE_BPS_DEFAULT = 100;

/**
 * Default treasury authority on Solana mainnet. Owns the SPL token
 * accounts (one ATA per stable mint) where Leash collects protocol fees.
 * Set `LEASH_FEE_AUTHORITY_MAINNET` to override (e.g. when migrating to
 * a multisig).
 */
export const LEASH_FEE_AUTHORITY_MAINNET_DEFAULT = '3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W';

/**
 * Default treasury authority on Solana devnet. Same key as mainnet by
 * design — devnet uses a separate ATA per mint anyway, so reusing the
 * authority just simplifies operational tooling. Override via
 * `LEASH_FEE_AUTHORITY_DEVNET`.
 */
export const LEASH_FEE_AUTHORITY_DEVNET_DEFAULT = '3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W';

/**
 * Enforcement modes for the Leash protocol fee.
 *
 *   - `off`     — facilitator ignores fee logic entirely. Vanilla x402
 *                 transactions verify exactly as before. Sellers that stamp
 *                 a fee `extra` still get one through, but the facilitator
 *                 will treat the second leg as an unknown instruction and
 *                 reject it. Use only for tests / local dev.
 *   - `warn`    — facilitator accepts both vanilla and fee-bearing payloads.
 *                 If a fee payload is malformed (wrong amount, wrong dest,
 *                 wrong authority), it logs and accepts. Use during the
 *                 rollout window where third-party clients haven't shipped
 *                 the upgrade yet.
 *   - `enforce` — facilitator REJECTS any payload that doesn't carry a
 *                 valid fee leg. The default once mainnet rollout is done.
 *
 * Default is `warn` so the upgrade lands without breaking older buyers.
 */
export type LeashFeeEnforcement = 'off' | 'warn' | 'enforce';

/**
 * Wire shape of the `paymentRequirements.extra['leash.fee']` block.
 *
 * Compact and sync-stampable: only the **static** fee parameters
 * travel on the wire (`bps`, `feeAuthority`). The buyer + facilitator
 * derive everything else (`feeAtomic`, `grossAtomic`, `feeDestination`)
 * on demand from `(paymentRequirements.amount, asset, tokenProgram)`
 * via {@link computeLeashFeeForRequirements} so all three surfaces
 * agree byte-for-byte without any round-tripping.
 *
 * Sync stamping matters because seller-kit's `createSeller(...)` is
 * a sync setup-time call; making it async would cascade through every
 * downstream caller (web playground, demos, docs, tests).
 */
export type LeashFeeExtra = {
  /**
   * Discriminator. Always `'1'`. Bump when the wire shape changes so
   * older facilitators reject incompatible payloads cleanly.
   */
  v: '1';
  /**
   * Fee rate in basis points the seller priced this `accepts[]` entry
   * for (e.g. `100` for 1%). Sellers and facilitators must agree.
   */
  bps: number;
  /**
   * Treasury authority pubkey (the wallet that owns the destination
   * fee ATA). Must match the env-configured authority on the
   * facilitator side or verify will reject.
   */
  feeAuthority: string;
};

/**
 * Compute the fee in atomic units for a given seller amount + bps,
 * rounding **up** (`ceil`) so dust never leaks out of the treasury.
 *
 * Examples (bps=100):
 *   - amount=1_000_000   → fee=10_000     (0.01 USDC for 1.00 USDC)
 *   - amount=1           → fee=1          (1 atom for 1 atom — ceil)
 *   - amount=999         → fee=10         (10 atoms for 999 atoms — ceil)
 *
 * @param amount seller leg amount in atomic units
 * @param bps    integer 0..10_000
 * @returns      atomic fee amount, never negative
 */
export function computeFeeAtoms(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`computeFeeAtoms: bps must be integer in [0, 10000], got ${bps}`);
  }
  if (amount < 0n) {
    throw new Error(`computeFeeAtoms: amount must be non-negative, got ${amount}`);
  }
  if (bps === 0 || amount === 0n) return 0n;
  const numerator = amount * BigInt(bps);
  // Ceil division for positive integers: (n + d - 1) / d
  return (numerator + 9_999n) / 10_000n;
}

/**
 * Convenience: given a `net` (seller's quoted) amount, return the
 * `(net, fee, gross)` triple where `gross = net + fee` and
 * `fee = ceilBps(net, bps)`.
 *
 * Use at seller-kit's `buildAccepts` time and on the buyer playground
 * UI to render "you will pay X" disclosures.
 */
export function applyFeeGrossUp(
  netAmount: bigint,
  bps: number = LEASH_FEE_BPS_DEFAULT,
): { net: bigint; fee: bigint; gross: bigint } {
  const fee = computeFeeAtoms(netAmount, bps);
  return { net: netAmount, fee, gross: netAmount + fee };
}

/**
 * Read the configured fee bps from env. Falls back to
 * {@link LEASH_FEE_BPS_DEFAULT} when unset / unparseable. Validates
 * the range so a bad env never surfaces as a 50_000 bps fee.
 */
export function resolveLeashFeeBps(): number {
  if (typeof process === 'undefined' || !process.env) return LEASH_FEE_BPS_DEFAULT;
  const raw = process.env.LEASH_FEE_BPS;
  if (!raw) return LEASH_FEE_BPS_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000) {
    // Cap at 10% (1000 bps) for sanity — anything higher is almost
    // certainly a misconfiguration.
    return LEASH_FEE_BPS_DEFAULT;
  }
  return parsed;
}

/**
 * Read the configured fee authority for the given network from env.
 * Falls back to the bundled defaults
 * ({@link LEASH_FEE_AUTHORITY_MAINNET_DEFAULT} /
 * {@link LEASH_FEE_AUTHORITY_DEVNET_DEFAULT}) when unset.
 */
export function resolveLeashFeeAuthority(network: TokenNetwork): string {
  const envKey =
    network === 'mainnet' ? 'LEASH_FEE_AUTHORITY_MAINNET' : 'LEASH_FEE_AUTHORITY_DEVNET';
  if (typeof process !== 'undefined' && process.env) {
    const raw = process.env[envKey];
    if (raw && raw.trim().length > 0) return raw.trim();
  }
  return network === 'mainnet'
    ? LEASH_FEE_AUTHORITY_MAINNET_DEFAULT
    : LEASH_FEE_AUTHORITY_DEVNET_DEFAULT;
}

/**
 * Read the enforcement mode for the given network from env. Per-network
 * vars override the global one. Default is `warn` everywhere so the
 * rollout doesn't break older clients overnight.
 */
export function resolveLeashFeeEnforcement(network: TokenNetwork): LeashFeeEnforcement {
  if (typeof process === 'undefined' || !process.env) return 'warn';
  const perNetwork =
    network === 'mainnet'
      ? process.env.LEASH_FEE_ENFORCE_MAINNET
      : process.env.LEASH_FEE_ENFORCE_DEVNET;
  const global = process.env.LEASH_FEE_ENFORCE;
  const raw = (perNetwork ?? global ?? 'warn').trim().toLowerCase();
  if (raw === 'off' || raw === 'warn' || raw === 'enforce') return raw;
  return 'warn';
}

/**
 * Treasury ATA descriptor. `ata` is the on-chain associated token
 * account address (where fees land); `authority` is the wallet that
 * owns it (the fee-payer for any future treasury sweep).
 */
export type LeashFeeAccount = {
  ata: Address;
  authority: Address;
};

/**
 * Derive the Leash fee ATA on the given `(network, asset, tokenProgram)`.
 * Both the seller (when stamping `extra['leash.fee'].feeDestination`)
 * and the facilitator (when verifying the second `TransferChecked`)
 * call this so they always agree on the destination.
 */
export async function getLeashFeeAtaFor(args: {
  network: TokenNetwork;
  /** SPL mint address the seller is collecting in. */
  asset: string;
  /**
   * Token program owning the mint. Pass `'spl-token'` for legacy
   * USDC/USDT and `'spl-token-2022'` for Token-2022 mints (USDG, etc.).
   */
  tokenProgram: 'spl-token' | 'spl-token-2022';
  /** Optional override; defaults to {@link resolveLeashFeeAuthority}. */
  authority?: string;
}): Promise<LeashFeeAccount> {
  const authority = (args.authority ?? resolveLeashFeeAuthority(args.network)) as string;
  const tokenProgram =
    args.tokenProgram === 'spl-token-2022' ? TOKEN_2022_PROGRAM_ADDRESS : TOKEN_PROGRAM_ADDRESS;
  const [ata] = await findAssociatedTokenPda({
    mint: toAddress(args.asset),
    owner: toAddress(authority),
    tokenProgram,
  });
  return { ata, authority: toAddress(authority) };
}

/**
 * Build the static `extra['leash.fee']` payload for a given seller leg.
 *
 * Sync by construction: the wire shape only carries `bps` and
 * `feeAuthority`, so seller-kit / payment-links can stamp this at
 * `buildAccepts` time without making `createSeller` async. The buyer +
 * facilitator derive the dynamic fields (`feeAtomic`, `grossAtomic`,
 * `feeDestination`) on demand via {@link computeLeashFeeForRequirements}.
 */
export function buildLeashFeeExtra(args: {
  network: TokenNetwork;
  /** Defaults to {@link resolveLeashFeeBps}. */
  bps?: number;
  /** Defaults to {@link resolveLeashFeeAuthority}. */
  authority?: string;
}): LeashFeeExtra {
  const bps = args.bps ?? resolveLeashFeeBps();
  const feeAuthority = args.authority ?? resolveLeashFeeAuthority(args.network);
  return { v: '1', bps, feeAuthority };
}

/**
 * Type guard + parser for an inbound `extra['leash.fee']` block. Returns
 * `null` if the value is absent or malformed (any field missing /
 * wrong type / out-of-range bps). Facilitators use this to decide whether
 * to apply fee verification.
 */
export function parseLeashFeeExtra(
  extra: Record<string, unknown> | null | undefined,
): LeashFeeExtra | null {
  if (!extra || typeof extra !== 'object') return null;
  const raw = extra['leash.fee'];
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.v !== '1') return null;
  const { bps, feeAuthority } = obj;
  if (
    typeof bps !== 'number' ||
    !Number.isInteger(bps) ||
    bps < 0 ||
    bps > 10_000 ||
    typeof feeAuthority !== 'string' ||
    feeAuthority.length === 0
  ) {
    return null;
  }
  return { v: '1', bps, feeAuthority };
}

/**
 * Resolved fee for a specific `paymentRequirements` entry. Buyer scheme
 * + facilitator scheme both call {@link computeLeashFeeForRequirements}
 * and then trust this exact triple, so they always agree.
 */
export type ResolvedLeashFee = {
  bps: number;
  feeAtomic: bigint;
  grossAtomic: bigint;
  feeAuthority: Address;
  feeDestination: Address;
};

/**
 * Resolve the per-request fee triple `(bps, feeAtomic, feeDestination)`
 * for a given `paymentRequirements` entry. Returns `null` if the
 * requirement carries no `extra['leash.fee']` (vanilla x402 mode).
 *
 * Both the buyer (when constructing the `TransferChecked` fee leg) and
 * the facilitator (when verifying the inbound transaction) call this
 * function so they always derive the same destination ATA + atomic
 * amount from the same inputs.
 */
export async function computeLeashFeeForRequirements(args: {
  network: TokenNetwork;
  /** SPL mint address (`paymentRequirements.asset`). */
  asset: string;
  /** Token program owning the mint. */
  tokenProgram: 'spl-token' | 'spl-token-2022';
  /** Seller leg amount in atomic units (`paymentRequirements.maxAmountRequired`). */
  amount: string;
  /** Parsed `extra['leash.fee']`. Pass `null` when absent. */
  extra: LeashFeeExtra | null;
}): Promise<ResolvedLeashFee | null> {
  if (!args.extra) return null;
  const bps = args.extra.bps;
  const net = BigInt(args.amount);
  const fee = computeFeeAtoms(net, bps);
  const acct = await getLeashFeeAtaFor({
    network: args.network,
    asset: args.asset,
    tokenProgram: args.tokenProgram,
    authority: args.extra.feeAuthority,
  });
  return {
    bps,
    feeAtomic: fee,
    grossAtomic: net + fee,
    feeAuthority: acct.authority,
    feeDestination: acct.ata,
  };
}
