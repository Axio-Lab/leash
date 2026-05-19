import { beforeAll, describe, expect, it, afterEach } from 'vitest';

import { createTestRig } from './helpers.js';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'a'.repeat(64);
const PRIVY_ID = 'did:privy:identity-demo';
const WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';
const MINT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';
const TREASURY = 'FZQ4SyEUxGRgTwT7DvKi8b8tqezZbTnpVvPm9wgL2Lz3';

const realFetch = globalThis.fetch;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = ENC_KEY;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function authHeaders() {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ADMIN_SECRET}`,
  };
}

async function createAgent() {
  const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
  await rig.db.execute({
    sql: 'INSERT INTO platform_users (privy_id, wallet, email) VALUES (?, ?, ?)',
    args: [PRIVY_ID, WALLET, null],
  });
  const res = await rig.app.fetch(
    new Request('http://test.local/v1/platform/agents', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        mint: MINT,
        treasury: TREASURY,
        owner_privy_id: PRIVY_ID,
        owner_wallet: WALLET,
        name: 'Identity Demo',
        network: 'solana-devnet',
        model: 'claude-3-5-sonnet',
        system_prompt: 'You are an identity test agent.',
        capabilities: [],
        budget: { per_action: '0.10', per_task: '1.00', per_day: '10.00' },
        llm_provider: 'platform',
      }),
    }),
  );
  expect(res.status).toBe(200);
  return rig;
}

describe('agent identity profile endpoints', () => {
  it('resolves handles and hides private capability cards from public profiles', async () => {
    const rig = await createAgent();
    const update = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/agents/${MINT}/identity`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          handle: '@payce-demo',
          capability_cards: [
            {
              kind: 'pay_skills',
              title: 'Email sender',
              source: 'pay-skills',
              slug: 'agentmail/email',
              endpoint: 'https://agentmail.example/send',
              protocols: ['x402'],
              visibility: 'public',
            },
            {
              kind: 'data_source',
              title: 'Private CRM',
              source: 'connection',
              visibility: 'private',
            },
          ],
        }),
      }),
    );
    expect(update.status).toBe(200);

    const profile = (await update.json()) as {
      handle: string;
      capability_cards: Array<{ title: string; visibility: string }>;
    };
    expect(profile.handle).toBe('payce-demo');
    expect(profile.capability_cards.map((card) => card.title)).toEqual(['Email sender']);

    const resolve = await rig.app.fetch(
      new Request('http://test.local/v1/identity/resolve?handle=payce-demo'),
    );
    expect(resolve.status).toBe(200);
    const resolved = (await resolve.json()) as { mint: string; capability_cards: unknown[] };
    expect(resolved.mint).toBe(MINT);
    expect(resolved.capability_cards).toHaveLength(1);
  });

  it('verifies well-known domains and resolves them to the agent identity', async () => {
    const rig = await createAgent();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://payce.example/.well-known/leash-agent.json');
      return new Response(JSON.stringify({ mint: MINT, network: 'solana-devnet' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const verify = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/agents/${MINT}/identity/domains/verify`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ domain: 'payce.example' }),
      }),
    );
    expect(verify.status).toBe(200);

    const resolved = await rig.app.fetch(
      new Request('http://test.local/v1/identity/resolve?domain=payce.example'),
    );
    expect(resolved.status).toBe(200);
    const body = (await resolved.json()) as { mint: string; verified_domains: string[] };
    expect(body.mint).toBe(MINT);
    expect(body.verified_domains).toEqual(['payce.example']);
  });

  it('publishes only public active claims and hides revoked claims', async () => {
    const rig = await createAgent();
    const publicClaim = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/agents/${MINT}/identity/claims`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          issuer: 'Leash Labs',
          type: 'verified_builder',
          value: 'true',
          signature: 'sig_1234567890123456',
        }),
      }),
    );
    expect(publicClaim.status).toBe(200);
    const publicBody = (await publicClaim.json()) as { id: string };

    const privateClaim = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/agents/${MINT}/identity/claims`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          issuer: 'Internal',
          type: 'private_note',
          value: 'hidden',
          visibility: 'private',
          signature: 'sig_1234567890123456',
        }),
      }),
    );
    expect(privateClaim.status).toBe(200);

    const profile = await rig.app.fetch(new Request(`http://test.local/v1/identity/${MINT}`));
    expect(profile.status).toBe(200);
    const profileBody = (await profile.json()) as { claims: Array<{ type: string }> };
    expect(profileBody.claims.map((claim) => claim.type)).toEqual(['verified_builder']);

    const revoke = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/agents/${MINT}/identity/claims/${publicBody.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      }),
    );
    expect(revoke.status).toBe(200);

    const after = await rig.app.fetch(new Request(`http://test.local/v1/identity/${MINT}`));
    const afterBody = (await after.json()) as { claims: unknown[] };
    expect(afterBody.claims).toEqual([]);
  });
});
