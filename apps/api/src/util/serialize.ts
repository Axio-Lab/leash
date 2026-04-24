/**
 * Wire-format helpers for unsigned/signed Solana transactions.
 *
 * The API hands callers a base64-encoded *unsigned* transaction (with
 * empty signature slots) plus the raw message bytes. Polyglot SDKs sign
 * the message bytes, then either replace the signature slots in the
 * transaction bytes and POST that to `/v1/submit`, or build a fresh
 * transaction from the message and signatures themselves — both wire
 * shapes are accepted by `POST /v1/submit`.
 */

import type { TransactionBuilder, Transaction, Umi } from '@metaplex-foundation/umi';
import { internal } from './errors.js';

export type WireTransaction = {
  /** Base64 of the full serialized transaction (with empty sig slots). */
  base64: string;
  /** Base64 of just the message bytes — sign these directly with ed25519. */
  message_base64: string;
  /** Recent blockhash baked into the message. */
  recent_blockhash: string;
  /**
   * Last block height the blockhash is valid for, when the RPC reports
   * one. Omitted for builders that pre-set their blockhash from a fixed
   * value.
   */
  last_valid_block_height?: number;
  /** First account in the message — the fee payer. */
  fee_payer: string;
  /** Public keys of every required signer (in account-key order). */
  signers: string[];
};

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Serialize a Umi `TransactionBuilder` to wire format. Sets a fresh
 * blockhash via the Umi RPC the builder is bound to — necessary because
 * builders are created lazily and don't know about chain state until we
 * ask.
 */
export async function serializeBuilder(
  umi: Umi,
  builder: TransactionBuilder,
): Promise<WireTransaction> {
  let withBlockhash: TransactionBuilder;
  let lastValidBlockHeight: number | undefined;
  try {
    const latest = await umi.rpc.getLatestBlockhash();
    withBlockhash = builder.setBlockhash(latest);
    if (typeof latest.lastValidBlockHeight === 'bigint') {
      lastValidBlockHeight = Number(latest.lastValidBlockHeight);
    } else if (typeof latest.lastValidBlockHeight === 'number') {
      lastValidBlockHeight = latest.lastValidBlockHeight;
    }
  } catch (err) {
    throw internal('failed to fetch recent blockhash', { cause: String(err) });
  }
  let tx: Transaction;
  try {
    tx = withBlockhash.build(umi);
  } catch (err) {
    throw internal('failed to build transaction', { cause: String(err) });
  }
  return serializeTransaction(umi, tx, lastValidBlockHeight);
}

/** Serialize a fully-built (but unsigned) Umi transaction. */
export function serializeTransaction(
  umi: Umi,
  tx: Transaction,
  lastValidBlockHeight?: number,
): WireTransaction {
  const txBytes = umi.transactions.serialize(tx);
  const messageBytes = umi.transactions.serializeMessage(tx.message);
  const required = tx.message.header.numRequiredSignatures;
  const signers = tx.message.accounts.slice(0, required).map((a) => String(a));
  const feePayer = signers[0] ?? '';
  return {
    base64: bytesToBase64(txBytes),
    message_base64: bytesToBase64(messageBytes),
    recent_blockhash: tx.message.blockhash,
    ...(lastValidBlockHeight !== undefined
      ? { last_valid_block_height: lastValidBlockHeight }
      : {}),
    fee_payer: feePayer,
    signers,
  };
}
