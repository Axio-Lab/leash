/**
 * Build the canonical X-Leash-Sig envelope and ed25519 signature for
 * authenticated agent requests.
 *
 * Mirrors `apps/api/src/auth/onchain.ts::buildSigningEnvelope` byte
 * for byte. The two implementations are kept in deliberate sync:
 * `packages/sdk` is browser/Bun/Deno-friendly (uses
 * `@metaplex-foundation/umi` for the eddsa primitives + a pure-JS
 * SHA-256 fallback), while the API uses Node's `node:crypto`.
 *
 * Callers shouldn't need to call this directly — `LeashClient`
 * stamps the headers on every authenticated request — but it's
 * exported for tests and tools that build their own request loop.
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';

const _umi = (() => {
  // We only need the `eddsa` primitive; the RPC URL is a placeholder.
  return createUmi('https://api.mainnet-beta.solana.com');
})();

export type SigningEnvelope = {
  method: string;
  pathWithQuery: string;
  timestamp: string;
  body: Uint8Array | string | undefined;
  agentMint: string;
};

export type SigningHeaders = {
  'x-leash-agent': string;
  'x-leash-timestamp': string;
  'x-leash-sig': string;
};

/**
 * Build the bytes the executive signs. Hashes the request body so we
 * commit to it without copying it verbatim into the canonical string.
 */
export async function buildEnvelope(args: SigningEnvelope): Promise<Uint8Array> {
  const bodyBytes =
    args.body == null
      ? new Uint8Array(0)
      : typeof args.body === 'string'
        ? new TextEncoder().encode(args.body)
        : args.body;
  const bodyHashHex = await sha256Hex(bodyBytes);
  const canonical = [
    args.method.toUpperCase(),
    args.pathWithQuery,
    args.timestamp,
    bodyHashHex,
    args.agentMint,
  ].join('\n');
  return new TextEncoder().encode(canonical);
}

/**
 * Sign an envelope and return the three headers the API verifier
 * expects. `executiveSecretBase58` must decode to a 64-byte ed25519
 * keypair (the same `solana-keygen output` format used by every
 * other Leash surface).
 */
export async function signRequest(args: {
  method: string;
  pathWithQuery: string;
  body: Uint8Array | string | undefined;
  agentMint: string;
  executiveSecretBase58: string;
  /** Override for tests. Defaults to current time. */
  timestamp?: string;
}): Promise<SigningHeaders> {
  const timestamp = args.timestamp ?? new Date().toISOString();
  const envelope = await buildEnvelope({
    method: args.method,
    pathWithQuery: args.pathWithQuery,
    timestamp,
    body: args.body,
    agentMint: args.agentMint,
  });
  const secret = base58.serialize(args.executiveSecretBase58);
  if (secret.length !== 64) {
    throw new Error(`executive secret must decode to 64 bytes (got ${secret.length})`);
  }
  const keypair = _umi.eddsa.createKeypairFromSecretKey(secret);
  const sig = _umi.eddsa.sign(envelope, keypair);
  return {
    'x-leash-agent': args.agentMint,
    'x-leash-timestamp': timestamp,
    'x-leash-sig': base58.deserialize(sig)[0],
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Browser, Bun, Deno, modern Node: use SubtleCrypto.
  // `globalThis.crypto.subtle` is the cross-runtime entry point.
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const buf = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Node ≤ 19 fallback. Importing inside the branch keeps the SDK
  // tree-shakeable in browser bundles.
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}
