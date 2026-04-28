import { describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';
import { validateManifest } from '../src/util/mcp-manifest.js';

const ADMIN_SECRET = 'a'.repeat(48);
const PRIVY_ID = 'did:privy:owner';
const WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';

function authHeaders() {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ADMIN_SECRET}`,
  };
}

const baseListing = {
  slug: 'usdc-airtime',
  name: 'USDC Airtime',
  description: 'Top up phones with USDC',
  category: 'fintech',
  owner_privy_id: PRIVY_ID,
  owner_wallet: WALLET,
  endpoint: 'https://airtime.example/mcp',
  pricing: { type: 'per_call', amount: '0.10', currency: 'USDC' },
  tools: [{ name: 'buy_airtime', description: 'Buy airtime' }],
  free_tier: 5,
};

describe('marketplace listings', () => {
  it('public browse defaults to status=approved (no admin secret needed)', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const create = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(baseListing),
      }),
    );
    expect(create.status).toBe(200);
    const created = (await create.json()) as { id: string; status: string };
    expect(created.status).toBe('pending');

    const browseEmpty = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings'),
    );
    expect(browseEmpty.status).toBe(200);
    const empty = (await browseEmpty.json()) as { items: unknown[] };
    expect(empty.items).toHaveLength(0);

    const approve = await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${created.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: 'approved' }),
      }),
    );
    expect(approve.status).toBe(200);

    const browse = await rig.app.fetch(new Request('http://test.local/v1/marketplace/listings'));
    expect(browse.status).toBe(200);
    const list = (await browse.json()) as { items: Array<{ slug: string; status: string }> };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.slug).toBe('usdc-airtime');
    expect(list.items[0]!.status).toBe('approved');
  });

  it('rejects creates without admin secret', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const r = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(baseListing),
      }),
    );
    expect(r.status).toBe(401);
  });

  it('detail endpoint includes rating summary', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const create = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(baseListing),
      }),
    );
    const created = (await create.json()) as { id: string; slug: string };
    await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${created.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: 'approved' }),
      }),
    );
    const summary1 = await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${created.slug}`),
    );
    expect(summary1.status).toBe(200);
    const before = (await summary1.json()) as { rating: { avg: number; count: number } };
    expect(before.rating.count).toBe(0);

    await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${created.id}/rating`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ privy_id: 'did:privy:rater', stars: 5 }),
      }),
    );
    const summary2 = await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${created.slug}`),
    );
    const after = (await summary2.json()) as { rating: { avg: number; count: number } };
    expect(after.rating.count).toBe(1);
    expect(after.rating.avg).toBe(5);
  });

  it('reviews can be added and listed', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const create = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(baseListing),
      }),
    );
    const { id } = (await create.json()) as { id: string };
    const post = await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${id}/reviews`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ privy_id: 'did:privy:rev1', body: 'works great' }),
      }),
    );
    expect(post.status).toBe(200);
    const list = await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${id}/reviews`),
    );
    expect(list.status).toBe(200);
    const items = ((await list.json()) as { items: Array<{ body: string }> }).items;
    expect(items.map((i) => i.body)).toEqual(['works great']);
  });

  it('repeat ratings from the same user upsert (no dedup-induced duplicate row)', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const create = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(baseListing),
      }),
    );
    const { id } = (await create.json()) as { id: string };
    await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${id}/rating`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ privy_id: 'did:privy:dup', stars: 1 }),
      }),
    );
    await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${id}/rating`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ privy_id: 'did:privy:dup', stars: 5 }),
      }),
    );
    const detail = await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${baseListing.slug}`),
    );
    const body = (await detail.json()) as { rating: { avg: number; count: number } };
    expect(body.rating.count).toBe(1);
    expect(body.rating.avg).toBe(5);
  });

  it('rejects duplicate slug', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(baseListing),
      }),
    );
    const dup = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(baseListing),
      }),
    );
    expect(dup.status).toBe(422);
  });
});

describe('manifest validation', () => {
  it('accepts a complete manifest', () => {
    const m = validateManifest({
      name: 'X',
      slug: 'x',
      description: 'd',
      endpoint: 'https://x.example/mcp',
      tools: [{ name: 't', description: 'd' }],
      pricing: { type: 'free' },
    });
    expect(m.name).toBe('X');
    expect(m.category).toBe('misc');
  });

  it('rejects bad pricing type', () => {
    expect(() =>
      validateManifest({
        name: 'X',
        description: 'd',
        endpoint: 'https://x.example/mcp',
        tools: [{ name: 't', description: 'd' }],
        pricing: { type: 'gift' },
      }),
    ).toThrow();
  });

  it('rejects malformed tool entries', () => {
    expect(() =>
      validateManifest({
        name: 'X',
        description: 'd',
        endpoint: 'https://x.example/mcp',
        tools: [{ description: 'no name' }],
        pricing: { type: 'free' },
      }),
    ).toThrow();
  });
});
