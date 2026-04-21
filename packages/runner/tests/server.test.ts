import { describe, expect, it } from 'vitest';
import { appendLine, createMemoryStore } from '../src/storage/memory.js';
import { createHttpServer } from '../src/http/server.js';

describe('runner http', () => {
  it('serves jsonl', async () => {
    const store = createMemoryStore();
    appendLine(store, 'mint1', '{"v":"0.1","nonce":0}');
    const app = createHttpServer(store);
    const res = await app.request('http://localhost/a/mint1/receipts.jsonl');
    expect(res.status).toBe(200);
    const t = await res.text();
    expect(t).toContain('nonce');
  });

  it('/pause reflects kill switch', async () => {
    const app = createHttpServer(createMemoryStore(), {
      resolvePause: async () => ({ paused: true, source: 'env' }),
    });
    const res = await app.request('http://localhost/pause');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paused: boolean; source: string };
    expect(body.paused).toBe(true);
    expect(body.source).toBe('env');
    const health = await app.request('http://localhost/health');
    const h = (await health.json()) as { ok: boolean; paused: boolean };
    expect(h.paused).toBe(true);
    expect(h.ok).toBe(false);
  });
});
