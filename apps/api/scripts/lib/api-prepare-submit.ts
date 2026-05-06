/**
 * Shared helpers for `apps/api/scripts/*` that drive the public
 * `prepare → sign → submit → track` lifecycle exposed by `@leashmarket/api`.
 *
 * Every state-changing route on the API returns one of two shapes:
 *
 *   { event_id, network, transaction: { base64, message_base64, ... }, echo }
 *   { event_id: null, network, transaction: null, echo, no_op: true }
 *
 * These helpers consume that envelope, sign the unsigned transaction
 * locally with a `Signer`, broadcast it through `POST /v1/submit`, and
 * poll `GET /v1/events/{id}` until the API's background confirmation
 * worker flips the row to `confirmed` (or `failed`). They deliberately
 * use only HTTP + Umi primitives so they exercise the same surface a
 * third-party SDK would.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { signTransaction, type Signer, type Umi } from '@metaplex-foundation/umi';

/** Wire shape returned by the API in `prepare*` responses. */
export type WireTransaction = {
  base64: string;
  message_base64: string;
  recent_blockhash: string;
  last_valid_block_height?: number;
  fee_payer: string;
  signers: string[];
};

export type PreparedResponse<TEcho> = {
  event_id: string;
  network: string;
  transaction: WireTransaction;
  echo: TEcho;
  no_op?: false;
};

export type PreparedNoOpResponse<TEcho> = {
  event_id: null;
  network: string;
  transaction: null;
  echo: TEcho;
  no_op: true;
};

export type PreparedEnvelope<TEcho> = PreparedResponse<TEcho> | PreparedNoOpResponse<TEcho>;

export type SubmitResponse = {
  event_id: string;
  signature: string;
  phase: 'submitted';
  network: string;
};

export type EventRow = {
  id: string;
  kind: string;
  phase: 'prepared' | 'submitted' | 'confirmed' | 'failed';
  network: string;
  signature: string | null;
  agent_asset: string | null;
  block_time?: number | null;
  error_code?: string | null;
  error_logs?: string | null;
};

/**
 * Type guard for the no-op envelope. Useful before reaching for
 * `.transaction.base64` so the TypeScript compiler narrows correctly.
 */
export function isNoOp<TEcho>(env: PreparedEnvelope<TEcho>): env is PreparedNoOpResponse<TEcho> {
  return env.no_op === true || env.transaction == null;
}

/**
 * Sign an API-prepared transaction with one or more local signers and
 * return the base64 the caller should POST to `/v1/submit`.
 *
 * Validates that every signer the API expects is actually present (no
 * silent partial-sign mismatches). Extra signers are tolerated — the
 * API only cares about the required ones.
 */
export async function signWireTransaction(
  umi: Umi,
  wire: WireTransaction,
  signers: Signer[],
): Promise<string> {
  const signerSet = new Set(signers.map((s) => String(s.publicKey)));
  const missing = wire.signers.filter((pk) => !signerSet.has(pk));
  if (missing.length > 0) {
    throw new Error(
      `signWireTransaction: missing signer(s) for required pubkey(s): ${missing.join(', ')}`,
    );
  }
  const bytes = new Uint8Array(Buffer.from(wire.base64, 'base64'));
  const tx = umi.transactions.deserialize(bytes);
  const signed = await signTransaction(tx, signers);
  return Buffer.from(umi.transactions.serialize(signed)).toString('base64');
}

/**
 * Poll `GET /v1/events/{event_id}` until the row reaches a terminal
 * phase (`confirmed` or `failed`) or `timeoutMs` elapses. Returns the
 * latest `EventRow`. Caller decides what to do with `failed` rows.
 */
export async function waitForEvent(
  fetchEvent: (id: string) => Promise<EventRow>,
  eventId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<EventRow> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 1_500;
  const started = Date.now();
  let last = await fetchEvent(eventId);
  while (last.phase !== 'confirmed' && last.phase !== 'failed') {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`waitForEvent: ${eventId} stuck at phase=${last.phase} after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
    last = await fetchEvent(eventId);
  }
  return last;
}
