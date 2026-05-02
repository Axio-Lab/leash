/**
 * Decode a base64url-or-base64 JSON blob (the encoding the x402
 * `payment-required` header uses). Tolerates missing padding.
 *
 * Throws if the input isn't decodable / parseable JSON — callers
 * should turn that into a clean `error` tool result.
 */
export function decodeBase64Json(input: string): unknown {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const raw =
    typeof globalThis.atob === 'function'
      ? globalThis.atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(raw);
}
