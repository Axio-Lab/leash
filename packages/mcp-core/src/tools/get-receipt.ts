/**
 * `leash_get_receipt` — fetch a single canonical receipt by its deterministic
 * `receipt_hash` (legacy v0.1 / dual-protocol v0.2).
 *
 * Why this exists
 * ---------------
 * The explorer renders a receipt detail page at `/receipt/{hash}` with
 * the full canonical JSON the seller published (including price legs,
 * facilitator URL, request shape, and on-chain settlement — `tx_sig` or
 * MPP `mpp_settlement_tx`). Agents
 * working over MCP/CLI need the same payload programmatically — to
 * verify a counterparty's claim ("here's the hash, prove the call was
 * paid"), reconcile bookkeeping against an internal ledger, or feed
 * downstream automations a structured proof of payment.
 *
 * The Leash API exposes this directly: `GET /v1/receipts/by-hash/{hash}`
 * returns the same row the indexer wrote during ingest. Network is
 * bound to the caller's API key prefix, so a `lsh_test_*` (devnet) key
 * cannot read a mainnet hash and vice-versa — that scoping is enforced
 * server-side and surfaced as `status: "not_found"`.
 */

import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  receipt_hash: z
    .string()
    .min(8)
    .max(128)
    .describe(
      'The 64-hex-char `receipt_hash` from a Leash receipt (v0.1 or v0.2). Same value the explorer renders at `/receipt/{hash}` and the buyer/seller kits return as `receipt.receipt_hash`. Network is bound to the host\u2019s API key.',
    ),
});

export const getReceiptTool = defineTool({
  name: 'leash_get_receipt',
  description: [
    'Look up a single receipt by its deterministic `receipt_hash` and return the full canonical JSON \u2014 the same blob the explorer shows at `/receipt/{hash}`.',
    'Use this when an agent or user hands you a hash and you need to surface the request URL, method, decision (allow/deny), price (amount/fee/gross), facilitator, on-chain settlement (`tx_sig` or MPP `mpp_settlement_tx`), and the prev/current hash chain.',
    'On `status: "ok"`, the `receipt` field holds the canonical object (v0.1 or v0.2 with `protocol`); an `explorer_url` is also returned so the LLM can quote a clickable link.',
    'Returns `status: "not_found"` if the hash exists on the sibling cluster (cross-network reads are impossible by design).',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.getReceipt(args),
});
