/**
 * Parse an MPP `402 Payment Required` HTTP response into a typed
 * {@link MppChallengeV1}. MPP carries the challenge in the **body** as
 * `application/problem+json` (RFC 7807-flavoured) — distinct from x402,
 * which carries it in the `payment-required` response header.
 *
 * Throws on every malformed shape so callers wrap once and surface the
 * message verbatim. The discriminator (`type === '...payment-required'`
 * + a non-empty `challengeId`) lets `detectProtocol` route confidently.
 */

import { MppChallengeV1Schema, type MppChallengeV1 } from '@leashmarket/schemas';

export const MPP_PROBLEM_TYPE = 'https://paymentauth.org/problems/payment-required';

/**
 * Read JSON safely from a Response — clones first so the caller can
 * still consume the body afterwards (e.g. for a debugger UI dump).
 */
async function readJsonClone(res: Response): Promise<unknown> {
  try {
    const cloned = res.clone();
    const text = await cloned.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Returns true if the Response body looks like an MPP 402 challenge.
 * Cheap structural check — doesn't run full Zod validation.
 */
export function looksLikeMppChallenge(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return b.type === MPP_PROBLEM_TYPE && typeof b.challengeId === 'string';
}

/**
 * Parse a `Response` (must be 402) into a strict {@link MppChallengeV1}.
 * The caller is responsible for confirming `response.status === 402`
 * (raw 402s with non-MPP bodies are x402 territory).
 */
export async function parseMppChallenge(response: Response): Promise<MppChallengeV1> {
  const body = await readJsonClone(response);
  if (!looksLikeMppChallenge(body)) {
    throw new Error('mpp: body is not an MPP problem+json challenge');
  }
  return MppChallengeV1Schema.parse(body);
}

/** Lower-level form for callers that have already JSON-parsed the body. */
export function parseMppChallengeBody(body: unknown): MppChallengeV1 {
  return MppChallengeV1Schema.parse(body);
}
