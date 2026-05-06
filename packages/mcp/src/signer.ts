/**
 * `LeashSigner` — the cryptographic primitive every standalone Leash
 * surface (MCP, CLI, SDK) shares. It's just an ed25519 keypair, but
 * we centralise loading + the few representations we need so the
 * tool code can stay representation-agnostic.
 *
 * Three representations come out of one secret:
 *
 *   - `umi.identity()` (Metaplex `Signer`) — used for the MPL Core
 *     `Execute` instruction during withdraws and the SPL `Approve`
 *     during delegate rotation.
 *
 *   - `@solana/kit` `TransactionSigner` — used by `@leashmarket/buyer-kit`
 *     when paying x402 links (the underlying x402 SVM scheme is
 *     written against `@solana/kit`).
 *
 *   - The bare `Uint8Array` secret + base58 `pubkey` — used for
 *     `X-Leash-Sig` HTTP signing in batch 4.
 *
 * Accepts either a base58 string OR the JSON-array shape that
 * `solana-keygen` writes by default. Throws on malformed input
 * because a misconfigured signer should fail loudly at boot, not
 * silently on first tool call.
 */

import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  keypairIdentity,
  publicKey as umiPublicKey,
  type Keypair as UmiKeypair,
  type PublicKey as UmiPublicKey,
  type Umi,
} from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { base58 } from '@metaplex-foundation/umi/serializers';

import type { SvmNetwork } from '@leashmarket/mcp-core';

export type LeashSigner = {
  /** Base58 ed25519 public key. */
  pubkey: string;
  /** 64-byte raw secret. Keep in memory only. */
  secret: Uint8Array;
  /**
   * Build a Umi instance configured with `mplCore` + `mplToolbox` and
   * this signer set as the identity. Memoised per Leash config so
   * repeat calls within one MCP process reuse the same RPC client.
   */
  getUmi(rpcUrl: string): Umi;
  /**
   * Build a `@solana/kit` `KeyPairSigner` for buyer-kit. Memoised.
   */
  getKitSigner(): Promise<KeyPairSigner>;
  /** Convenience: the executive's pubkey as a Umi PublicKey. */
  umiPubkey: UmiPublicKey;
};

/** Decode the loose secret form into a 64-byte Uint8Array. */
function decodeSecretBytes(secret: string): Uint8Array {
  const trimmed = secret.trim();

  // solana-keygen JSON shape.
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new Error('executive secret JSON must be a 64-element byte array');
    }
    const bytes = Uint8Array.from(parsed.map((n) => Number(n)));
    if (bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
      throw new Error('executive secret JSON contains non-byte values');
    }
    return bytes;
  }

  // base58.
  try {
    const bytes = base58.serialize(trimmed);
    if (bytes.length !== 64) {
      throw new Error(
        `executive secret must decode to 64 bytes (got ${bytes.length}). Use solana-keygen output verbatim.`,
      );
    }
    return bytes;
  } catch (err) {
    throw new Error(
      `executive secret is not a valid base58 string: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
}

/**
 * Build a `LeashSigner` from a raw secret string. Sets up the lazy
 * Umi + kit-signer caches; nothing network-touching happens until a
 * tool actually needs them.
 */
export function loadSigner(secretRaw: string): LeashSigner {
  const secret = decodeSecretBytes(secretRaw);

  // Derive pubkey via a temporary Umi so we don't carry an extra
  // ed25519 lib just for this one call.
  const probe = createUmi('https://invalid');
  const umiKp: UmiKeypair = probe.eddsa.createKeypairFromSecretKey(secret);
  const pubkeyStr = umiKp.publicKey.toString();

  let umi: Umi | null = null;
  let cachedRpcUrl: string | null = null;
  let kitSigner: KeyPairSigner | null = null;

  const getUmi = (rpcUrl: string): Umi => {
    if (umi && cachedRpcUrl === rpcUrl) return umi;
    umi = createUmi(rpcUrl).use(mplCore()).use(mplToolbox());
    const kp: UmiKeypair = umi.eddsa.createKeypairFromSecretKey(secret);
    umi.use(keypairIdentity(kp));
    cachedRpcUrl = rpcUrl;
    return umi;
  };

  const getKitSigner = async (): Promise<KeyPairSigner> => {
    if (kitSigner) return kitSigner;
    kitSigner = await createKeyPairSignerFromBytes(secret);
    return kitSigner;
  };

  return {
    pubkey: pubkeyStr,
    secret,
    getUmi,
    getKitSigner,
    umiPubkey: umiPublicKey(pubkeyStr),
  };
}

/** Ergonomic helper for callers that have a network-friendly slug. */
export function defaultRpcFor(network: SvmNetwork): string {
  return network === 'solana-mainnet'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com';
}
