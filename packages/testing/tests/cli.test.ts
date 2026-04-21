import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeReceipt } from '@leash/core';
import { describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../dist/cli/conformance.js', import.meta.url));

const draft = {
  v: '0.1' as const,
  kind: 'spend' as const,
  agent: 'Agent1111111111111111111111111111111111',
  ts: '2026-01-01T00:00:00.000Z',
  policy_v: '0.1',
  request: { method: 'GET', url: 'https://a.com', body_hash: null },
  decision: 'allow' as const,
  reason: null,
  price: { amount: '0.001', currency: 'USDC' },
  facilitator: 'local' as const,
  response: { status: 200, body_hash: null },
};

describe('leash-conformance CLI', () => {
  it('exits 0 on a valid two-line feed', () => {
    const a = finalizeReceipt({ ...draft, nonce: 0, prev_receipt_hash: null, tx_sig: 'a' });
    const b = finalizeReceipt({
      ...draft,
      nonce: 1,
      prev_receipt_hash: a.receipt_hash,
      tx_sig: 'b',
    });
    const dir = mkdtempSync(join(tmpdir(), 'leash-conf-'));
    const file = join(dir, 'feed.jsonl');
    writeFileSync(file, `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`);
    const out = execFileSync(process.execPath, [cliPath, file], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual({ ok: true, count: 2 });
  });
});
