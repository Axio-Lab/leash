/**
 * Build a {@link FacilitatorSvmSigner} from a base58 / JSON-byte secret
 * key. The signer is the on-chain principal that the facilitator uses
 * to:
 *
 *   - **Pay transaction fees** for every settled `TransferChecked` call.
 *     Buyers don't have to hold SOL; the facilitator is the fee payer.
 *   - **Sign as fee payer** before broadcasting (the buyer has already
 *     partially-signed as the token owner; we add the second signature).
 *
 * Funding the signer:
 *
 *   - **Devnet** — request airdrops from <https://faucet.solana.com>
 *     against the address printed at startup. ~0.05 SOL is enough for
 *     thousands of settlements.
 *   - **Mainnet** — top up out-of-band; the facilitator will refuse to
 *     start if the env var isn't set.
 *
 * Secret key formats accepted (autodetected):
 *
 *   - **JSON byte array** as exported by the Solana CLI
 *     (`solana-keygen new -o key.json` → `[171, 47, ...]`).
 *   - **base58** (single string, 64 bytes encoded — the same format
 *     `Phantom`/`Solflare` use for "export private key").
 */

import {
  createKeyPairSignerFromBytes,
  type TransactionSigner,
  type MessagePartialSigner,
} from '@solana/kit';
import { toFacilitatorSvmSigner, type FacilitatorSvmSigner } from '@x402/svm';

export type LeashFacilitatorSignerOptions = {
  /**
   * Either a JSON-encoded byte array (`"[12,34,...]"`) or a base58
   * secret key string. Length must decode to 64 bytes.
   */
  secretKey: string;
  /**
   * Optional default RPC URL used by all networks. Per-network RPCs can
   * be configured via {@link createFacilitatorServer}'s `rpcs` map.
   */
  defaultRpcUrl?: string;
};

/**
 * Decode a Solana 64-byte secret key from either a Solana-CLI JSON byte
 * array or a base58 string. Throws a clear error on every other shape so
 * config typos surface at startup, not on the first verify call.
 */
function decodeSecretKey(input: string): Uint8Array {
  const trimmed = input.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== 'number')) {
      throw new Error('LEASH_FACILITATOR_SECRET_KEY: invalid JSON byte array');
    }
    const bytes = new Uint8Array(parsed as number[]);
    if (bytes.length !== 64) {
      throw new Error(`LEASH_FACILITATOR_SECRET_KEY: expected 64 bytes, got ${bytes.length}`);
    }
    return bytes;
  }
  // base58 fallback. We avoid pulling in `bs58` as a hard dep; fall back to
  // a tight inline decoder so the package stays light.
  return base58Decode(trimmed);
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(input: string): Uint8Array {
  const map = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    map[BASE58_ALPHABET.charCodeAt(i)] = i;
  }
  let zeros = 0;
  while (zeros < input.length && input.charCodeAt(zeros) === 49 /* '1' */) zeros++;
  const size = ((input.length - zeros) * 733) / 1000 + 1; // log(58)/log(256) ≈ 0.733
  const b256 = new Uint8Array(size | 0);
  let length = 0;
  for (let i = zeros; i < input.length; i++) {
    let carry = map[input.charCodeAt(i)];
    if (carry < 0) {
      throw new Error(`LEASH_FACILITATOR_SECRET_KEY: invalid base58 char "${input[i]}"`);
    }
    let j = 0;
    for (let k = b256.length - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 58 * b256[k]!;
      b256[k] = carry & 0xff;
      carry >>= 8;
    }
    length = j;
  }
  const out = new Uint8Array(zeros + length);
  let offset = zeros;
  let i = b256.length - length;
  while (i < b256.length) out[offset++] = b256[i++]!;
  if (out.length !== 64) {
    throw new Error(`LEASH_FACILITATOR_SECRET_KEY: decoded length ${out.length}, expected 64`);
  }
  return out;
}

export type ResolvedFacilitatorSigner = {
  /** SVM signer suitable for `registerExactSvmScheme`. */
  signer: FacilitatorSvmSigner;
  /** Public addresses the signer can act as (operational visibility). */
  addresses: readonly string[];
};

/**
 * Build the `FacilitatorSvmSigner` used by `registerExactSvmScheme`.
 * Logs the resolved address(es) for ops visibility; this is what
 * needs SOL to pay tx fees.
 */
export async function buildFacilitatorSigner(
  opts: LeashFacilitatorSignerOptions,
): Promise<ResolvedFacilitatorSigner> {
  const bytes = decodeSecretKey(opts.secretKey);
  const keypair = (await createKeyPairSignerFromBytes(bytes)) as TransactionSigner &
    MessagePartialSigner;
  const signer = toFacilitatorSvmSigner(
    keypair,
    opts.defaultRpcUrl ? { defaultRpcUrl: opts.defaultRpcUrl } : undefined,
  );
  return { signer, addresses: signer.getAddresses().map(String) };
}
