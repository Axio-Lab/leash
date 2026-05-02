/**
 * Map raw on-chain / wallet / API errors into a single-sentence,
 * human-readable string suitable for a toast or inline form error.
 *
 * Rules:
 *   - exactly one sentence (no logs, no stack traces)
 *   - actionable when possible ("fund SOL", "retry in a few seconds")
 *   - never longer than ~160 chars
 *   - never reveal raw program IDs or simulation logs
 */
export function formatChainError(err: unknown, fallback = 'Something went wrong.'): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();

  // User cancelled in the wallet.
  if (
    raw.includes('user rejected') ||
    raw.includes('user declined') ||
    raw.includes('rejected the request') ||
    raw.includes('was cancelled') ||
    raw.includes('cancelled by user')
  ) {
    return 'Transaction was cancelled in your wallet.';
  }

  // Privy / wallet not ready.
  if (raw.includes('wallet not ready') || raw.includes('not connected')) {
    return 'Connect a Solana wallet first, then try again.';
  }

  // Insufficient SOL for gas / rent.
  if (
    raw.includes('insufficient lamports') ||
    raw.includes('insufficient funds for fee') ||
    raw.includes('attempt to debit an account but found no record of a prior credit') ||
    raw.includes('insufficientfundsforrent') ||
    raw.includes('insufficient funds for rent')
  ) {
    return 'Not enough SOL on this wallet to pay transaction fees — fund it from a faucet and retry.';
  }

  // SPL Token Insufficient funds (during transfer/withdraw).
  if (raw.includes('insufficient funds') || raw.match(/0x1\b(?!\d)/)) {
    return 'Insufficient token balance for this transfer.';
  }

  // mpl-core "Invalid Asset" (0x18) — usually the asset isn't visible to the
  // wallet's RPC yet because the mint just landed.
  if (raw.includes('invalid asset passed in') || raw.includes('custom program error: 0x18')) {
    return 'Agent record is not visible to the network yet — wait a few seconds and retry.';
  }

  // Blockhash expiry.
  if (raw.includes('blockhash') && (raw.includes('expired') || raw.includes('not found'))) {
    return 'Transaction expired before signing — please retry.';
  }
  if (raw.includes('block height exceeded')) {
    return 'Transaction expired before signing — please retry.';
  }

  // Network / RPC issues.
  if (
    raw.includes('failed to fetch') ||
    raw.includes('network error') ||
    raw.includes('econnrefused') ||
    raw.includes('econnreset') ||
    raw.includes('timeout')
  ) {
    return 'Network error — check your connection and retry.';
  }

  // RPC rate-limit.
  if (raw.includes('429') || raw.includes('rate limit')) {
    return 'RPC rate-limited the request — wait a moment and retry.';
  }

  // Privy invalid input.
  if (raw.includes('invalid public key') || raw.includes('non-base58')) {
    return 'That address is not a valid Solana public key.';
  }

  // API errors with our own structure.
  if (raw.includes('http 401') || raw.includes('unauthenticated')) {
    return 'Your session expired — sign in again and retry.';
  }
  if (raw.includes('http 5') || raw.includes('upstream')) {
    return 'Leash API is unreachable right now — try again in a moment.';
  }

  // Truncate anything else to a single short sentence.
  const single = (err instanceof Error ? err.message : String(err ?? fallback))
    .split('\n')[0]
    .trim();
  if (single.length === 0) return fallback;
  if (single.length > 160) return `${single.slice(0, 157)}…`;
  // Drop trailing program-id noise like "(program logs at …)".
  return single.replace(/\s*\(program logs at .+\)$/i, '');
}
