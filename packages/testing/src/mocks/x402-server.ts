import { Hono } from 'hono';

const PAY_HEADER = 'x-payment';

/** Minimal server: 402 without payment header, 200 with header. */
export function createX402MockServer(): Hono {
  const app = new Hono();
  app.get('/ping', (c) => {
    if (!c.req.header(PAY_HEADER)) {
      return c.json({ error: 'payment required' }, 402);
    }
    return c.json({ ok: true });
  });
  app.post('/tag', async (c) => {
    if (!c.req.header(PAY_HEADER)) {
      return c.json({ error: 'payment required' }, 402);
    }
    const body = await c.req.json().catch(() => ({}));
    return c.json({ tagged: true, ...body });
  });
  return app;
}
