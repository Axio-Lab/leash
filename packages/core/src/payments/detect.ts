/**
 * Single source of truth for "is this a 402 from x402 or MPP?".
 *
 * Used by buyer-kit, the MCP `pay_payment_link` tool, the CLI, and the
 * frontend probe modal so every surface dispatches consistently.
 *
 * Contract:
 *   - x402: `payment-required` response header carrying a base64-JSON
 *           envelope with `accepts[]`.
 *   - MPP : `application/problem+json` body whose `type` is the MPP
 *           payment-required URI, plus a non-empty `challengeId`.
 *
 * Returns `null` if the response isn't a 402 at all (callers can short-
 * circuit), or `{ protocol: 'unknown' }` for a 402 we couldn't parse —
 * callers usually surface that as a hard failure.
 */

import { MPP_PROBLEM_TYPE, looksLikeMppChallenge, parseMppChallengeBody } from '../mpp/parse.js';
import type { MppChallengeV1 } from '@leashmarket/schemas';

export type ProtocolDetection =
  | {
      status: 402;
      protocol: 'x402';
      /** Raw `payment-required` header value (base64-JSON). Caller decodes if needed. */
      paymentRequiredHeader: string;
    }
  | {
      status: 402;
      protocol: 'mpp';
      challenge: MppChallengeV1;
    }
  | {
      status: 402;
      protocol: 'unknown';
      /** Best-effort body / header diagnostics for the debugger UI. */
      detail: string;
    }
  | {
      status: number;
      protocol: 'none';
    };

/**
 * Detect the payment protocol of a `Response`. Clones the body before
 * reading so the caller can still consume it afterwards (debugger UIs
 * often want to render the raw bytes).
 */
export async function detectProtocol(response: Response): Promise<ProtocolDetection> {
  if (response.status !== 402) {
    return { status: response.status, protocol: 'none' };
  }

  const headerValue =
    response.headers.get('payment-required') ?? response.headers.get('PAYMENT-REQUIRED');
  if (headerValue && headerValue.length > 0) {
    return { status: 402, protocol: 'x402', paymentRequiredHeader: headerValue };
  }

  // MPP path: parse the body. Don't consume the original response.
  let bodyText = '';
  try {
    bodyText = await response.clone().text();
  } catch {
    // ignore
  }
  if (bodyText.length > 0) {
    let body: unknown = null;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      body = null;
    }
    if (looksLikeMppChallenge(body)) {
      return { status: 402, protocol: 'mpp', challenge: parseMppChallengeBody(body) };
    }
  }
  return {
    status: 402,
    protocol: 'unknown',
    detail: bodyText ? bodyText.slice(0, 400) : 'no body, no payment-required header',
  };
}

/**
 * Stricter form for callers that already know they hit a 402. Throws
 * on `none` / `unknown` so the call-site can do `try/catch` cleanly.
 */
export async function detectProtocolStrict(
  response: Response,
): Promise<
  | { protocol: 'x402'; paymentRequiredHeader: string }
  | { protocol: 'mpp'; challenge: MppChallengeV1 }
> {
  const det = await detectProtocol(response);
  if (det.protocol === 'none') {
    throw new Error(`expected 402 from paywall, got HTTP ${det.status}`);
  }
  if (det.protocol === 'unknown') {
    throw new Error(`paywall response is neither x402 nor MPP: ${det.detail}`);
  }
  if (det.protocol === 'x402') {
    return { protocol: 'x402', paymentRequiredHeader: det.paymentRequiredHeader };
  }
  return { protocol: 'mpp', challenge: det.challenge };
}

export { MPP_PROBLEM_TYPE };
