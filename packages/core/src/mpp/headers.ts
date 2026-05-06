/**
 * MPP credential header construction + parsing.
 *
 * MPP-on-Solana piggybacks on the standard HTTP `Authorization` header
 * with a custom scheme prefix. The buyer signs an SPL transfer that
 * matches the challenge `request` block (recipient/amount/asset), then
 * sends:
 *
 *   Authorization: PaymentScheme <base64(MppCredential)>
 *
 * The credential body shape we use mirrors the x402 PaymentPayload —
 * a base64-wire signed Solana transaction plus the originating
 * `challengeId`. The seller forwards `(challengeId, signedTx)` to the
 * facilitator, which verifies and broadcasts.
 */

import { decodeBase64Json } from '../mpp-helpers/base64-json.js';

export const MPP_AUTH_SCHEME = 'PaymentScheme';

export const MPP_HEADERS = {
  /** Buyer-supplied credential. */
  authorization: 'authorization',
  /** Seller -> buyer settlement proof header (mirror of x402 PAYMENT-RESPONSE). */
  paymentReceipt: 'x-payment-receipt',
} as const;

export type MppCredentialV1 = {
  v: '1';
  challengeId: string;
  /** Base64-encoded wire transaction the facilitator will broadcast. */
  signedTx: string;
  /**
   * Optional buyer signature over the canonicalised challenge nonce.
   * Reserved for non-Solana rails; on Solana the SPL transfer signature
   * is itself proof of authorization.
   */
  nonceSig?: string;
};

const MPP_CREDENTIAL_VERSION = '1' as const;

/**
 * Encode an MPP credential into the value half of an `Authorization`
 * header (everything after `PaymentScheme `).
 */
export function encodeMppCredential(credential: MppCredentialV1): string {
  const json = JSON.stringify(credential);
  const bytes = new TextEncoder().encode(json);
  // Browser-safe base64. Falls back to Node's Buffer when present.
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}

/**
 * Build a full `Authorization: PaymentScheme <base64>` header value.
 */
export function buildMppAuthorizationHeader(credential: MppCredentialV1): string {
  return `${MPP_AUTH_SCHEME} ${encodeMppCredential(credential)}`;
}

/**
 * Parse a value already stripped of the scheme prefix into a typed
 * credential. Throws on malformed input.
 */
export function decodeMppCredential(encoded: string): MppCredentialV1 {
  const parsed = decodeBase64Json(encoded) as MppCredentialV1 | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('mpp: malformed credential payload');
  }
  if (parsed.v !== MPP_CREDENTIAL_VERSION) {
    throw new Error(`mpp: unsupported credential version "${parsed.v}"`);
  }
  if (typeof parsed.challengeId !== 'string' || parsed.challengeId.length === 0) {
    throw new Error('mpp: credential missing challengeId');
  }
  if (typeof parsed.signedTx !== 'string' || parsed.signedTx.length === 0) {
    throw new Error('mpp: credential missing signedTx');
  }
  return parsed;
}

/**
 * Parse a raw `Authorization` header value (with or without the scheme
 * prefix). Returns `null` when the header is absent or uses a different
 * scheme — callers should treat that as "buyer didn't pay yet".
 */
export function parseMppAuthorization(header: string | null | undefined): MppCredentialV1 | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  // Accept both "PaymentScheme <b64>" and a bare b64 payload (defensive).
  const prefix = `${MPP_AUTH_SCHEME} `;
  const encoded = trimmed.toLowerCase().startsWith(prefix.toLowerCase())
    ? trimmed.slice(prefix.length).trim()
    : trimmed;
  if (!encoded) return null;
  return decodeMppCredential(encoded);
}

export const MPP_CREDENTIAL_VERSION_LITERAL = MPP_CREDENTIAL_VERSION;
