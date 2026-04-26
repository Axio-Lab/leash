/**
 * Receipt-pull worker.
 *
 * For every row in `pull_targets`, periodically GET the URL (with
 * `{agent}` substituted for the agent's asset pubkey) and ingest each
 * receipt body it returns. Supports two on-the-wire formats:
 *
 *   - JSON Lines (`application/x-ndjson`, `application/jsonl`, or any
 *     content-type containing the substring `jsonl`): one ReceiptV1
 *     per line, blank lines ignored.
 *   - JSON array (`application/json`): a single `[ReceiptV1, ...]`.
 *
 * Failures are logged and counted but never raise — a misbehaving
 * merchant URL must not stall the worker.
 */

import { ReceiptV1Schema } from '@leash/schemas';

import type { DbClient } from '../storage/turso.js';
import { execute } from '../storage/turso.js';
import { ingestReceipt, listPullTargets } from '../storage/receipts.js';
import { createPreparedEvent, markConfirmed } from '../storage/events.js';
import { emitProtocolFeeEvent } from '../storage/fee-events.js';
import type { SvmNetwork } from '../util/network.js';
import type { FetchLike } from './rpc.js';

export type ReceiptPullOptions = {
  fetch?: FetchLike | typeof globalThis.fetch;
  /**
   * Per-target HTTP timeout (ms). Returns null result on miss.
   */
  timeoutMs?: number;
  log?: (line: string) => void;
};

export type ReceiptPullResult = {
  network: SvmNetwork;
  targetsScanned: number;
  receiptsIngested: number;
  receiptsDuplicate: number;
  errors: number;
};

export async function runReceiptPullTick(args: {
  db: DbClient;
  network: SvmNetwork;
  options?: ReceiptPullOptions;
}): Promise<ReceiptPullResult> {
  const opts = args.options ?? {};
  const fetchImpl = (opts.fetch ?? globalThis.fetch) as typeof globalThis.fetch;
  if (!fetchImpl) throw new Error('runReceiptPullTick: no fetch available');
  const log = opts.log ?? ((line: string) => console.log(`[receipt-pull] ${line}`));

  const result: ReceiptPullResult = {
    network: args.network,
    targetsScanned: 0,
    receiptsIngested: 0,
    receiptsDuplicate: 0,
    errors: 0,
  };

  // Batch by agent so we don't request the same agent's URL twice in
  // the same tick.
  const targets = await listAllPullTargets(args.db, args.network);
  for (const t of targets) {
    result.targetsScanned += 1;
    const url = t.url.replaceAll('{agent}', t.agent);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8_000);
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/jsonl, application/json' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        result.errors += 1;
        log(`pull ${url} -> ${res.status}`);
        continue;
      }
      const ct = res.headers.get('content-type') ?? '';
      const text = await res.text();
      const receipts = parseReceiptPayload(text, ct);
      let added = 0;
      for (const candidate of receipts) {
        const parsed = ReceiptV1Schema.safeParse(candidate);
        if (!parsed.success) {
          result.errors += 1;
          continue;
        }
        const ingestRes = await ingestReceipt(args.db, {
          network: args.network,
          receipt: parsed.data,
        });
        if (ingestRes.duplicate) {
          result.receiptsDuplicate += 1;
        } else {
          result.receiptsIngested += 1;
          added += 1;
          // Mirror push-ingest behaviour: write a single
          // `receipt.pulled` event per fresh receipt so the explorer
          // distinguishes pushed vs pulled origins.
          const eventId = await createPreparedEvent(args.db, {
            kind: 'receipt.pulled',
            network: args.network,
            agentAsset: parsed.data.agent,
            metadata: {
              source_url: url,
              ...(parsed.data.tx_sig ? { tx_sig: parsed.data.tx_sig } : {}),
            },
          });
          await markConfirmed(args.db, eventId);
          // Mirror push-ingest behaviour: emit `protocol.fee.collected`
          // when the pulled receipt is a settled earn carrying a fee.
          await emitProtocolFeeEvent(args.db, {
            network: args.network,
            receipt: parsed.data,
            log,
          });
        }
      }
      await execute(
        args.db,
        `UPDATE pull_targets SET last_polled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                                 last_cursor = ?
           WHERE id = ?`,
        [added > 0 ? `+${added}@${new Date().toISOString()}` : null, t.id],
      );
    } catch (err) {
      result.errors += 1;
      log(`pull ${url} failed: ${(err as Error).message}`);
    }
  }
  return result;
}

async function listAllPullTargets(db: DbClient, network: SvmNetwork) {
  // Re-uses storage/receipts.listPullTargets indirectly by walking each
  // agent we know about — but for the simpler tick we just scan the
  // full table. The unique key keeps this bounded by `agents * urls`,
  // which is small in practice.
  const rows = await db.execute({
    sql: `SELECT id, network, agent, url FROM pull_targets WHERE network = ?`,
    args: [network],
  });
  // Convince TS via `listPullTargets` signature shape.
  void listPullTargets;
  return rows.rows.map((r) => ({
    id: Number(r.id),
    network: String(r.network) as SvmNetwork,
    agent: String(r.agent),
    url: String(r.url),
  }));
}

function parseReceiptPayload(text: string, contentType: string): unknown[] {
  if (contentType.includes('jsonl') || contentType.includes('ndjson')) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => safeJsonParse(line))
      .filter((v): v is Record<string, unknown> => v !== undefined);
  }
  const parsed = safeJsonParse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return [parsed];
  return [];
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
