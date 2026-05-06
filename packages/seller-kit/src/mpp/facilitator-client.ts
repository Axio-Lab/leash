/**
 * Minimal client for the Leash MPP facilitator endpoint.
 *
 * The facilitator (`@leashmarket/facilitator`, Phase 5) exposes a JSON
 * `POST /mpp/settle` that accepts `(challenge, signedTx)` and returns
 * `(success, transaction, slot, error?)`. Sellers call this from their
 * MPP middleware once a buyer has presented a credential — the seller
 * never broadcasts on-chain itself.
 */

import type { MppChallengeV1 } from '@leashmarket/schemas';

export type MppSettleResult =
  | {
      success: true;
      /** Solana SPL transfer signature. */
      transaction: string;
      /** Confirmed slot. */
      slot: string | number;
    }
  | {
      success: false;
      error: string;
      /** Optional Solana sig if the tx was broadcast but failed. */
      transaction?: string;
    };

export type MppFacilitatorClient = {
  url: string;
  settle(args: { challenge: MppChallengeV1; signedTx: string }): Promise<MppSettleResult>;
};

export type CreateMppFacilitatorClientOptions = {
  url: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

export function createMppFacilitatorClient(
  opts: CreateMppFacilitatorClientOptions,
): MppFacilitatorClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const base = opts.url.replace(/\/+$/, '');
  return {
    url: base,
    async settle({ challenge, signedTx }): Promise<MppSettleResult> {
      let res: Response;
      try {
        res = await fetchImpl(`${base}/mpp/settle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ challenge, signedTx }),
        });
      } catch (e) {
        return { success: false, error: `mpp_facilitator_unreachable: ${(e as Error).message}` };
      }
      let parsed: unknown = null;
      try {
        parsed = (await res.json()) as unknown;
      } catch {
        return { success: false, error: `mpp_facilitator_bad_json: HTTP ${res.status}` };
      }
      if (!res.ok || !parsed || typeof parsed !== 'object') {
        const detail =
          parsed && typeof parsed === 'object' && 'error' in parsed
            ? String((parsed as { error: unknown }).error)
            : `HTTP ${res.status}`;
        return { success: false, error: detail };
      }
      const obj = parsed as Record<string, unknown>;
      if (obj.success === true && typeof obj.transaction === 'string') {
        return {
          success: true,
          transaction: obj.transaction,
          slot: (obj.slot as string | number) ?? '0',
        };
      }
      return {
        success: false,
        error: typeof obj.error === 'string' ? obj.error : 'mpp_facilitator_failed',
        ...(typeof obj.transaction === 'string' ? { transaction: obj.transaction } : {}),
      };
    },
  };
}
