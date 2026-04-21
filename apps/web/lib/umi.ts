// Server-only module: never import from a Client Component. The dev payer
// secret key lives in this process and must not be shipped to the browser.
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, publicKey, type PublicKey, type Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplAgentIdentity, mplAgentTools } from '@metaplex-foundation/mpl-agent-registry';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { SOLANA_RPC } from './env';

/**
 * Decodes a Solana secret key. Accepts either a base58 string (Phantom export
 * format) or a JSON-serialised `Uint8Array` (`solana-keygen` format).
 */
function decodeSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed) as number[];
    return Uint8Array.from(arr);
  }
  return base58.serialize(trimmed);
}

/**
 * Server-only Umi instance whose identity is the dev payer keypair from
 * `LEASH_DEV_PAYER_SECRET_KEY`. This wallet pays for and signs all on-chain
 * actions issued by the playground (mint, register-executive, delegate, …).
 *
 * Because the secret key lives on the server, the playground is dev-only.
 * Production should swap this for a Privy / wallet-adapter signer wired
 * directly in the browser via `walletAdapterIdentity` from
 * `@metaplex-foundation/umi-signer-wallet-adapters`.
 */
export function getServerUmi(): Umi {
  const secret = process.env.LEASH_DEV_PAYER_SECRET_KEY;
  if (!secret) {
    throw new Error(
      'LEASH_DEV_PAYER_SECRET_KEY is not set. Add a base58 or JSON Solana secret key to apps/web/.env.local — the playground uses it as the on-chain payer for createAgent, registerExecutive, and delegateExecution.',
    );
  }
  const secretKey = decodeSecretKey(secret);
  const umi = createUmi(SOLANA_RPC).use(mplCore()).use(mplAgentIdentity()).use(mplAgentTools());
  const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  umi.use(keypairIdentity(keypair));
  return umi;
}

/** Read-only Umi (no identity) for fetching accounts. */
export function getReadOnlyUmi(): Umi {
  return createUmi(SOLANA_RPC).use(mplCore()).use(mplAgentIdentity()).use(mplAgentTools());
}

export function asPublicKey(s: string): PublicKey {
  return publicKey(s);
}
