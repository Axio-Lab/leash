/**
 * Agent operator keypair helpers.
 *
 * In Leash, an "agent" has two distinct cryptographic identities:
 *
 *   1. The **Core asset** — minted via the Metaplex Agent API, used as the
 *      agent's stable on-chain identity / receiver address. Its keypair is
 *      generated server-side by the API and isn't returned to the caller,
 *      so we can't sign with it after the mint.
 *   2. The **operator keypair** — generated locally at agent-creation time
 *      and held by the agent's host (browser localStorage in the
 *      playground; KMS / TEE / Phala in production). This is what the
 *      agent uses to autonomously sign x402 SPL transfers, run policy
 *      evaluation, and act on the open internet.
 *
 * The operator pubkey can optionally be advertised in the agent's
 * `AgentMetadata.registrations` so any peer can verify the binding by
 * reading on-chain identity.
 *
 * These helpers are pure and have **no Solana RPC / Web3 dependencies**
 * so the same code runs in Node, the browser, and edge runtimes.
 */

import { sha256 } from '@noble/hashes/sha256';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';
import bs58 from 'bs58';

/**
 * Serialised form of an Ed25519 keypair compatible with what
 * `solana-keygen` writes to disk: a 64-byte JSON array (32 secret + 32
 * public). This is also the shape `@solana/kit`'s
 * `createKeyPairSignerFromBytes` accepts.
 */
export type OperatorSecretBytes = Uint8Array; // length 64

/** Public-facing identity of an operator. */
export type OperatorPublicId = {
  /** Base58 Solana pubkey. */
  pubkey: string;
  /** Hex-encoded SHA-256 of the pubkey, useful for short labels. */
  fingerprint: string;
};

export type OperatorKeypair = {
  publicKey: Uint8Array; // 32 bytes
  secretKey: Uint8Array; // 64 bytes (secret || public, same as solana-keygen)
  pubkey: string; // base58 pubkey
};

/**
 * Generate a fresh Ed25519 operator keypair. Uses the platform's CSPRNG
 * (`crypto.getRandomValues`) which is available in Node 19+, all modern
 * browsers, and edge runtimes.
 */
export function generateOperatorKeypair(): OperatorKeypair {
  const seed = new Uint8Array(32);
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error(
      'No CSPRNG available — generateOperatorKeypair requires `crypto.getRandomValues`.',
    );
  }
  crypto.getRandomValues(seed);
  return operatorFromSeed(seed);
}

/**
 * Deterministically derive an operator keypair from a 32-byte seed.
 * Useful for tests and for deriving from a higher-level mnemonic / KMS.
 */
export function operatorFromSeed(seed: Uint8Array): OperatorKeypair {
  if (seed.length !== 32) {
    throw new Error(`operatorFromSeed: seed must be 32 bytes, got ${seed.length}`);
  }
  // Solana keypairs are stored as `secret(32) || public(32)` (64 bytes total).
  const publicKey = ed25519.getPublicKey(seed);
  const secretKey = new Uint8Array(64);
  secretKey.set(seed, 0);
  secretKey.set(publicKey, 32);
  return {
    publicKey,
    secretKey,
    pubkey: bs58.encode(publicKey),
  };
}

/** Sign a 32-byte digest (or any payload) with an operator keypair. */
export function signWithOperator(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  if (secretKey.length !== 64) {
    throw new Error(`signWithOperator: secretKey must be 64 bytes, got ${secretKey.length}`);
  }
  // ed25519 expects the 32-byte seed; Solana stores secret||public so we
  // slice the first 32 bytes.
  return ed25519.sign(message, secretKey.slice(0, 32));
}

/**
 * Serialise an operator keypair to the same JSON byte-array format that
 * `solana-keygen` uses (and which `@solana/kit`'s
 * `createKeyPairSignerFromBytes` accepts directly).
 *
 * ```ts
 * fs.writeFileSync('operator.json', exportOperatorJson(kp));
 * // → "[12,34, … ,255]"
 * ```
 */
export function exportOperatorJson(kp: OperatorKeypair): string {
  return JSON.stringify(Array.from(kp.secretKey));
}

/**
 * Parse a `solana-keygen`-style JSON byte array (or already-decoded array)
 * back into an operator keypair. Throws on length / format errors.
 */
export function importOperatorJson(raw: string | number[] | Uint8Array): OperatorKeypair {
  let bytes: Uint8Array;
  if (typeof raw === 'string') {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('importOperatorJson: expected JSON array of bytes');
    }
    bytes = new Uint8Array(parsed as number[]);
  } else if (raw instanceof Uint8Array) {
    bytes = raw;
  } else {
    bytes = new Uint8Array(raw);
  }
  if (bytes.length !== 64) {
    throw new Error(`importOperatorJson: expected 64 bytes, got ${bytes.length}`);
  }
  const secretKey = bytes;
  const publicKey = secretKey.slice(32);
  return {
    publicKey,
    secretKey,
    pubkey: bs58.encode(publicKey),
  };
}

/** Public-only summary suitable for logs / UI without leaking the secret. */
export function operatorPublicId(kp: OperatorKeypair): OperatorPublicId {
  const digest = sha256(kp.publicKey).slice(0, 8);
  return {
    pubkey: kp.pubkey,
    fingerprint: bytesToHex(digest),
  };
}

/**
 * Decode a base58 Solana pubkey back to bytes. Throws on invalid input.
 * Useful when the caller stores the pubkey as a string and later wants to
 * compare to a freshly-generated keypair.
 */
export function pubkeyToBytes(pubkey: string): Uint8Array {
  const bytes = bs58.decode(pubkey);
  if (bytes.length !== 32) {
    throw new Error(`pubkeyToBytes: expected 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

/**
 * Build the `AgentRegistration[]` entry that advertises an operator
 * pubkey on-chain via the Metaplex Agent Identity. The string form
 * mirrors the SVM CAIP convention (`solana:<pubkey>`) so off-chain
 * resolvers can disambiguate from EVM identities.
 */
export function operatorRegistration(pubkey: string): { agentRegistry: string; agentId: string } {
  return { agentRegistry: 'leash:operator', agentId: `solana:${pubkey}` };
}

/** Inverse of {@link operatorRegistration}. Returns `null` if not an operator entry. */
export function readOperatorRegistration(
  reg: { agentRegistry: string; agentId: string } | null | undefined,
): string | null {
  if (!reg || reg.agentRegistry !== 'leash:operator') return null;
  const m = /^solana:([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(reg.agentId);
  return m ? m[1]! : null;
}
