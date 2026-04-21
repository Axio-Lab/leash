import { describe, expect, it } from 'vitest';
import { createEndpointStore } from '../src/storage/endpoints.js';
import { createHttpServer } from '../src/http/server.js';
import { createMemoryStore } from '../src/storage/memory.js';

const OWNER_AGENT = '11111111111111111111111111111111';
const SECOND_OWNER = '22222222222222222222222222222222';

function newApp() {
  const endpoints = createEndpointStore();
  const app = createHttpServer(createMemoryStore(), { endpoints });
  return { app, endpoints };
}

function endpointBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    label: 'GPT premium echo',
    description: 'Echoes back JSON for paying agents.',
    owner_agent: OWNER_AGENT,
    method: 'POST',
    price: '$0.01',
    network: 'solana-devnet',
    response: { status: 200, mimeType: 'application/json', body: { ok: true } },
    ...overrides,
  };
}

describe('runner endpoints CRUD', () => {
  it('POST /endpoints creates an endpoint with a generated id', async () => {
    const { app } = newApp();
    const res = await app.request('http://localhost/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpointBody()),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; endpoint: { id: string; v: string } };
    expect(json.ok).toBe(true);
    expect(json.endpoint.v).toBe('0.1');
    expect(json.endpoint.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('POST /endpoints honors a caller-supplied id', async () => {
    const { app } = newApp();
    const res = await app.request('http://localhost/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpointBody({ id: 'echo-pro' })),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { endpoint: { id: string } };
    expect(json.endpoint.id).toBe('echo-pro');
  });

  it('rejects malformed bodies with 422', async () => {
    const { app } = newApp();
    const res = await app.request('http://localhost/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong: 'shape' }),
    });
    expect(res.status).toBe(422);
  });

  it('GET /endpoints filters by ?owner_agent', async () => {
    const { app } = newApp();
    const post1 = await app.request('http://localhost/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpointBody({ id: 'echo-1' })),
    });
    expect(post1.status, await post1.clone().text()).toBe(200);
    const post2 = await app.request('http://localhost/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpointBody({ id: 'echo-2', owner_agent: SECOND_OWNER })),
    });
    expect(post2.status, await post2.clone().text()).toBe(200);
    const all = (await (await app.request('http://localhost/endpoints')).json()) as {
      endpoints: { id: string }[];
    };
    expect(all.endpoints).toHaveLength(2);
    const filtered = (await (
      await app.request(`http://localhost/endpoints?owner_agent=${OWNER_AGENT}`)
    ).json()) as { endpoints: { id: string }[] };
    expect(filtered.endpoints).toHaveLength(1);
    expect(filtered.endpoints[0]?.id).toBe('echo-1');
  });

  it('GET /endpoints/:id returns 404 for unknown ids', async () => {
    const { app } = newApp();
    const res = await app.request('http://localhost/endpoints/missing');
    expect(res.status).toBe(404);
  });

  it('accepts optional redirect_url, webhook_url, wrap_receipt fields', async () => {
    const { app } = newApp();
    const res = await app.request('http://localhost/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        endpointBody({
          id: 'with-hooks',
          redirect_url: 'https://example.com/thanks',
          webhook_url: 'https://example.com/leash-callback',
          wrap_receipt: true,
        }),
      ),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const json = (await res.json()) as {
      endpoint: { redirect_url?: string; webhook_url?: string; wrap_receipt?: boolean };
    };
    expect(json.endpoint.redirect_url).toBe('https://example.com/thanks');
    expect(json.endpoint.webhook_url).toBe('https://example.com/leash-callback');
    expect(json.endpoint.wrap_receipt).toBe(true);
  });

  it('rejects non-http URLs in redirect_url / webhook_url', async () => {
    const { app } = newApp();
    const res = await app.request('http://localhost/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpointBody({ id: 'bad-url', redirect_url: 'javascript:alert(1)' })),
    });
    expect(res.status).toBe(422);
  });

  it('DELETE /endpoints/:id removes the endpoint', async () => {
    const { app } = newApp();
    await app.request('http://localhost/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpointBody({ id: 'kill-me' })),
    });
    const del = await app.request('http://localhost/endpoints/kill-me', { method: 'DELETE' });
    expect(del.status).toBe(204);
    const after = await app.request('http://localhost/endpoints/kill-me');
    expect(after.status).toBe(404);
  });
});
