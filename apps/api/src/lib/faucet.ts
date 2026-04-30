/**
 * Server-owned Solana wallet used by the agent self-registration and
 * sandbox endpoints to pay gas and (for sandbox) fund freshly minted
 * agent treasuries with a small amount of SOL + USDC.
 *
 * Why a single shared wallet
 * --------------------------
 * The standalone MCP server, the CLI, and any third-party agent that
 * calls `POST /v1/agents/self-register` does not (yet) have any SOL on
 * the cluster — they're brand new. The faucet wallet is the on-ramp
 * we own, just like Stripe's "test mode" issues a fee-free virtual
 * card for sandbox API callers.
 *
 * Configuration: `LEASH_API_FAUCET_SECRET` accepts either a base58-encoded
 * solana secret key (64 raw bytes) or a JSON byte array (`[1,2,...]`),
 * matching the convention used by `apps/api/scripts/e2e-devnet.ts`. Stored
 * in plaintext in env (server-only — never returned over the API). For
 * production we recommend a separate hot wallet topped up periodically.
 *
 * The Umi instances are memoised per (network, kind) so we don't pay the
 * createUmi cost on every request. The faucet keypair is loaded lazily
 * (first call) so the server can boot without it set; the endpoints
 * themselves return a clean 503 when the env is missing.
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  keypairIdentity,
  publicKey,
  transactionBuilder,
  type Instruction,
  type Keypair,
  type PublicKey,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore } from '@metaplex-foundation/mpl-core';
import {
  mplToolbox,
  findAssociatedTokenPda,
  createTokenIfMissing,
  transferSol,
} from '@metaplex-foundation/mpl-toolbox';

import { TOKEN_2022_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID } from '@leash/registry-utils';

import type { LeashApiConfig } from '../config.js';
import type { SvmNetwork } from '../util/network.js';
import { internal, invalidRequest } from '../util/errors.js';

// ────────────────────────────────────────────────────────────────────────────
// Devnet token catalogue (matches apps/api/scripts/fund.ts)
// ────────────────────────────────────────────────────────────────────────────

export type FaucetTokenSpec = {
  symbol: string;
  mint: string;
  decimals: number;
  programId: PublicKey;
};

export const FAUCET_TOKENS: Record<string, FaucetTokenSpec> = {
  USDC: {
    symbol: 'USDC',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
    programId: SPL_TOKEN_PROGRAM_ID,
  },
  USDG: {
    symbol: 'USDG',
    mint: '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7',
    decimals: 6,
    programId: TOKEN_2022_PROGRAM_ID,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Keypair loading
// ────────────────────────────────────────────────────────────────────────────

let cachedKeypairBytes: Uint8Array | null = null;

function decodeSecret(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.every((n) => typeof n === 'number')) {
        return Uint8Array.from(arr as number[]);
      }
    } catch {
      // fall through to base58 attempt
    }
  }
  try {
    return base58.serialize(trimmed);
  } catch (err) {
    throw new Error(
      `LEASH_API_FAUCET_SECRET: not a valid base58 or JSON-array secret (${(err as Error).message})`,
    );
  }
}

function loadFaucetSecret(config: LeashApiConfig): Uint8Array {
  if (cachedKeypairBytes) return cachedKeypairBytes;
  if (!config.faucetSecret) {
    throw internal(
      'agent self-registration is disabled: LEASH_API_FAUCET_SECRET is not set on this server.',
    );
  }
  cachedKeypairBytes = decodeSecret(config.faucetSecret);
  if (cachedKeypairBytes.length !== 64) {
    throw new Error(
      `LEASH_API_FAUCET_SECRET: expected 64 secret-key bytes, got ${cachedKeypairBytes.length}`,
    );
  }
  return cachedKeypairBytes;
}

// ────────────────────────────────────────────────────────────────────────────
// Umi factory (memoised per network)
// ────────────────────────────────────────────────────────────────────────────

const umiCache = new Map<SvmNetwork, Umi>();

export function getFaucetUmi(config: LeashApiConfig, network: SvmNetwork): Umi {
  const cached = umiCache.get(network);
  if (cached) return cached;
  const secret = loadFaucetSecret(config);
  const umi = createUmi(config.rpc[network]).use(mplCore()).use(mplToolbox());
  const kp: Keypair = umi.eddsa.createKeypairFromSecretKey(secret);
  umi.use(keypairIdentity(kp));
  umiCache.set(network, umi);
  return umi;
}

export function getFaucetPubkey(
  config: LeashApiConfig,
  network: SvmNetwork = 'solana-devnet',
): string {
  const umi = getFaucetUmi(config, network);
  return String(umi.identity.publicKey);
}

// ────────────────────────────────────────────────────────────────────────────
// On-chain helpers used by the registration / sandbox endpoints.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Send a small SOL drip to the executive pubkey so it can pay tx fees
 * for future on-chain ops (delegation re-issue, withdrawals, identity
 * updates).
 */
export async function fundExecutiveSol(args: {
  umi: Umi;
  destination: string;
  lamports: bigint;
}): Promise<string> {
  const { umi, destination, lamports } = args;
  const builder = transferSol(umi, {
    destination: publicKey(destination),
    amount: { basisPoints: lamports, identifier: 'SOL', decimals: 9 },
  });
  const res = await builder.sendAndConfirm(umi);
  return base58.deserialize(res.signature)[0];
}

/**
 * Fund a freshly minted agent's treasury with a small SPL drip.
 * Idempotently creates the treasury ATA + sends a TransferChecked from
 * the faucet ATA. Returns the tx signature.
 *
 * Throws `invalidRequest` if the requested token is not in our devnet
 * catalogue, or `internal` if the faucet ATA is empty.
 */
export async function fundTreasurySpl(args: {
  umi: Umi;
  treasuryPda: string;
  symbol: keyof typeof FAUCET_TOKENS;
  amountAtomic: bigint;
}): Promise<string> {
  const { umi, treasuryPda, symbol, amountAtomic } = args;
  const token = FAUCET_TOKENS[symbol];
  if (!token) throw invalidRequest(`unsupported faucet token ${String(symbol)}`);
  const ownerPubkey = umi.identity.publicKey;
  const [sourceAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(token.mint),
    owner: ownerPubkey,
    tokenProgramId: token.programId,
  });
  const [destAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(token.mint),
    owner: publicKey(treasuryPda),
    tokenProgramId: token.programId,
  });
  const destAcct = await umi.rpc.getAccount(destAta);
  let builder = transactionBuilder();
  if (!destAcct.exists) {
    builder = builder.add(
      createTokenIfMissing(umi, {
        mint: publicKey(token.mint),
        owner: publicKey(treasuryPda),
        ata: destAta,
        tokenProgram: token.programId,
      }),
    );
  }
  const transferIx = buildTransferCheckedIx({
    source: sourceAta,
    mint: publicKey(token.mint),
    destination: destAta,
    authority: ownerPubkey,
    amount: amountAtomic,
    decimals: token.decimals,
    programId: token.programId,
  });
  builder = builder.add({
    instruction: transferIx,
    signers: [umi.identity],
    bytesCreatedOnChain: 0,
  });
  const res = await builder.sendAndConfirm(umi);
  return base58.deserialize(res.signature)[0];
}

// ────────────────────────────────────────────────────────────────────────────
// SPL TransferChecked (program-agnostic between SPL Token + Token-2022)
// ────────────────────────────────────────────────────────────────────────────

function uintLeBytes(value: bigint, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  let v = value;
  for (let i = 0; i < byteLen; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Hand-rolled `TransferChecked` instruction (discriminator 12) that
 * works for both SPL Token and SPL Token-2022 (same opcode + layout).
 * Same shape used in `apps/api/scripts/fund.ts`.
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
  data.set(uintLeBytes(args.amount, 8), 1);
  data[9] = args.decimals;
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

// ────────────────────────────────────────────────────────────────────────────
// Reset for tests
// ────────────────────────────────────────────────────────────────────────────

/** Test hook — drop the cached keypair + Umi so subsequent calls re-read env. */
export function _resetFaucetCacheForTests(): void {
  cachedKeypairBytes = null;
  umiCache.clear();
}
