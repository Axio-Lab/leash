/**
 * Cheap base58 sanity check — Solana pubkeys are 32–44 base58 chars.
 * Rejects obvious typos (whitespace, '0OIl' confusables) so we don't
 * silently pass garbage to the chain. The real signature check happens
 * downstream (in the buyer-kit / mpl-core::Execute instruction).
 */
export function isLikelyBase58Address(s: string): boolean {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
}
