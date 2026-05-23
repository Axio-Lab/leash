import { describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';
import { createListing, setListingStatus } from '../src/storage/listings.js';
import { validateManifest } from '../src/util/mcp-manifest.js';

const ADMIN_SECRET = 'a'.repeat(48);
const PRIVY_ID = 'did:privy:owner';
const WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';
const SELLER_MINT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';
const OTHER_SELLER_MINT = '7N4s9veb5E8mMDEBPR6VgDJt9r9QqUopxk2QGxk8fyHc';

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
  seller_agent_mint: SELLER_MINT,
  endpoint: 'https://airtime.example/mcp',
  pricing: { type: 'per_call', amount: '0.10', currency: 'USDC' },
  tools: [{ name: 'buy_airtime', description: 'Buy airtime' }],
  free_tier: 5,
};

async function createSellerAgent(
  rig: Awaited<ReturnType<typeof createTestRig>>,
  args: { mint?: string; ownerPrivyId?: string; ownerWallet?: string } = {},
) {
  await rig.db.execute({
    sql: `INSERT INTO agents (
      mint, owner_privy_id, owner_wallet, name, description, image_url,
      network, model, system_prompt, capabilities, services,
      budget_per_action, budget_per_task, budget_per_day,
      treasury, service_key_id, encrypted_llm_key, llm_provider, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      args.mint ?? SELLER_MINT,
      args.ownerPrivyId ?? PRIVY_ID,
      args.ownerWallet ?? WALLET,
      'Seller Identity',
      'Identity-backed seller agent',
      null,
      'solana-devnet',
      'platform',
      'You sell marketplace capabilities.',
      '[]',
      '[]',
      '0.10',
      '1.00',
      '10.00',
      'FZQ4SyEUxGRgTwT7DvKi8b8tqezZbTnpVvPm9wgL2Lz3',
      `svc_${args.mint ?? SELLER_MINT}`,
      'sealed',
      'platform',
      'active',
    ],
  });
}

describe('marketplace listings', () => {
  it('public browse defaults to status=approved (no admin secret needed)', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await createSellerAgent(rig);
    const create = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(baseListing),
      }),
    );
    expect(create.status).toBe(200);
    const created = (await create.json()) as { id: string; status: string };
    expect(created.status).toBe('approved');

    const browse = await rig.app.fetch(new Request('http://test.local/v1/marketplace/listings'));
    expect(browse.status).toBe(200);
    const list = (await browse.json()) as { items: Array<{ slug: string; status: string }> };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.slug).toBe('usdc-airtime');
    expect(list.items[0]!.status).toBe('approved');
  });

  it('rejects creates without admin secret', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await createSellerAgent(rig);
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
    await createSellerAgent(rig);
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
    const before = (await summary1.json()) as {
      rating: { avg: number; count: number };
      listing: { seller_agent_mint: string; seller_identity: { mint: string } };
      identity_verification: { verdict: string } | null;
    };
    expect(before.rating.count).toBe(0);
    expect(before.listing.seller_agent_mint).toBe(SELLER_MINT);
    expect(before.listing.seller_identity.mint).toBe(SELLER_MINT);
    expect(before.identity_verification?.verdict).toBe('warn');

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
    await createSellerAgent(rig);
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
    await createSellerAgent(rig);
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
    await createSellerAgent(rig);
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

  it('rejects a seller agent mint owned by another Privy user', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await createSellerAgent(rig, {
      mint: OTHER_SELLER_MINT,
      ownerPrivyId: 'did:privy:other',
      ownerWallet: WALLET,
    });
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ...baseListing, seller_agent_mint: OTHER_SELLER_MINT }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it('keeps legacy unlinked listings readable with null seller identity fields', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const legacy = await createListing(rig.db, {
      slug: 'legacy-capability',
      name: 'Legacy Capability',
      description: 'Existing listing before identity anchoring',
      category: 'legacy',
      ownerPrivyId: PRIVY_ID,
      ownerWallet: WALLET,
      endpoint: 'https://legacy.example/mcp',
      pricing: { type: 'free' },
      tools: [{ name: 'legacy', description: 'Legacy tool' }],
    });
    await setListingStatus(rig.db, legacy.id, 'approved');

    const detail = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings/legacy-capability'),
    );
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      listing: { seller_agent_mint: string | null; seller_identity: unknown | null };
      identity_verification: unknown | null;
    };
    expect(body.listing.seller_agent_mint).toBeNull();
    expect(body.listing.seller_identity).toBeNull();
    expect(body.identity_verification).toBeNull();
  });

  it('syncs marketplace listings into seller identity capability cards', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    await createSellerAgent(rig);
    const create = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(baseListing),
      }),
    );
    const created = (await create.json()) as { id: string };

    const ownerProfile = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/agents/${SELLER_MINT}/identity`, {
        headers: authHeaders(),
      }),
    );
    const ownerBody = (await ownerProfile.json()) as {
      capability_cards: Array<{ id: string; visibility: string }>;
    };
    expect(ownerBody.capability_cards).toMatchObject([
      { id: `marketplace:${created.id}`, visibility: 'public' },
    ]);

    const publicProfile = await rig.app.fetch(
      new Request(`http://test.local/v1/identity/${SELLER_MINT}`),
    );
    const publicBody = (await publicProfile.json()) as {
      capability_cards: Array<{ id: string; visibility: string; slug: string }>;
    };
    expect(publicBody.capability_cards).toMatchObject([
      { id: `marketplace:${created.id}`, visibility: 'public', slug: baseListing.slug },
    ]);
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
