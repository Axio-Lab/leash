import { beforeAll, describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';
import { decryptSecret } from '@leashmarket/platform-auth/encryption';

const ADMIN_SECRET = 'a'.repeat(48);
const ENC_KEY = 'a'.repeat(64); // 32-byte hex
const PRIVY_ID = 'did:privy:demo';
const WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';
const MINT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';
const TREASURY = 'FZQ4SyEUxGRgTwT7DvKi8b8tqezZbTnpVvPm9wgL2Lz3';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = ENC_KEY;
});

function authHeaders() {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ADMIN_SECRET}`,
  };
}

describe('platform agent endpoints', () => {
  it('returns 503 when admin secret is not configured', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/platform/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(503);
  });

  it('rejects requests without admin secret', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/platform/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('creates an agent, encrypts the LLM key, issues a service key, and lists by owner', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const seedUser = `INSERT INTO platform_users (privy_id, wallet, email) VALUES (?, ?, ?)`;
    await rig.db.execute({ sql: seedUser, args: [PRIVY_ID, WALLET, null] });

    const res = await rig.app.fetch(
      new Request('http://test.local/v1/platform/agents', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          mint: MINT,
          treasury: TREASURY,
          owner_privy_id: PRIVY_ID,
          owner_wallet: WALLET,
          name: 'Researcher',
          network: 'solana-devnet',
          model: 'claude-3-5-sonnet',
          system_prompt: 'You are a Solana research agent.',
          capabilities: [
            { slug: null, endpoint: 'https://search.example/mcp', tools: ['search'], paid: false },
          ],
          budget: { per_action: '0.10', per_task: '1.00', per_day: '10.00' },
          llm_provider: 'anthropic',
          llm_api_key: 'sk-ant-secret-123',
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agent: {
        mint: string;
        owner_privy_id: string;
        service_key_id: string;
        capabilities: Array<{ endpoint: string; tools: string[] }>;
      };
      service_key_plaintext: string;
    };
    expect(body.agent.mint).toBe(MINT);
    expect(body.agent.capabilities).toHaveLength(1);
    expect(body.service_key_plaintext.startsWith('lsh_test_')).toBe(true);

    // Verify the service key authenticates against a regular user-key endpoint.
    const userRes = await rig.app.fetch(
      new Request('http://test.local/v1/events', {
        headers: { authorization: `Bearer ${body.service_key_plaintext}` },
      }),
    );
    expect(userRes.status).toBe(200);

    // The encrypted_llm_key column should round-trip through decryptSecret.
    const dbRow = await rig.db.execute({
      sql: 'SELECT encrypted_llm_key FROM agents WHERE mint = ?',
      args: [MINT],
    });
    const encrypted = String(dbRow.rows[0]!.encrypted_llm_key);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(decryptSecret(encrypted, ENC_KEY)).toBe('sk-ant-secret-123');

    // List by owner returns it.
    const list = await rig.app.fetch(
      new Request(
        `http://test.local/v1/platform/agents?owner_privy_id=${encodeURIComponent(PRIVY_ID)}`,
        { headers: authHeaders() },
      ),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { items: Array<{ mint: string }> };
    expect(listBody.items.map((i) => i.mint)).toEqual([MINT]);

    // PATCH capabilities adds a new tool and persists.
    const patch = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/agents/${MINT}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          capabilities: [
            { slug: null, endpoint: 'https://search.example/mcp', tools: ['search'] },
            {
              slug: 'usdc-airtime',
              endpoint: 'https://airtime.example/mcp',
              tools: ['buy_airtime'],
              paid: true,
            },
          ],
        }),
      }),
    );
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as { capabilities: Array<{ endpoint: string }> };
    expect(patched.capabilities).toHaveLength(2);

    // DELETE disables the agent and revokes the service key.
    const del = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/agents/${MINT}`, {
        method: 'DELETE',
        headers: authHeaders(),
      }),
    );
    expect(del.status).toBe(200);
    const after = await rig.app.fetch(
      new Request('http://test.local/v1/events', {
        headers: { authorization: `Bearer ${body.service_key_plaintext}` },
      }),
    );
    expect(after.status).toBe(401);
  });

  it('returns 404 for a missing agent', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const res = await rig.app.fetch(
      new Request(`http://test.local/v1/platform/agents/${MINT}`, { headers: authHeaders() }),
    );
    expect(res.status).toBe(404);
  });
});
