/**
 * Phase 3 smoke test for the 90-second demo path.
 *
 * Exercises the full Phase 1+2 backend in one go without touching the
 * UI or RPC: seed listings → create platform user → mint agent record →
 * enqueue a task → record activities → confirm everything queryable.
 *
 * Keeps us honest that the public-facing demo flow stays green even as
 * we touch storage and routes.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';

const ADMIN = 'a'.repeat(48);
const ENC = 'a'.repeat(64);
const PRIVY_ID = 'did:privy:demo';
const WALLET = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';
const TREASURY = 'FZQ4SyEUxGRgTwT7DvKi8b8tqezZbTnpVvPm9wgL2Lz3';
const MINT = '4Nd1mWcYWYn7Z9wsCSKwa5e2W7Lo23Yp8h2gEHn8oAB7';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = ENC;
});

function admin() {
  return { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}` };
}

describe('demo flow smoke', () => {
  it('seeds a listing, mints an agent, enqueues a task, and surfaces public stats', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN });

    const listingRes = await rig.app.fetch(
      new Request('http://test.local/v1/marketplace/listings', {
        method: 'POST',
        headers: admin(),
        body: JSON.stringify({
          slug: 'data-fetch',
          name: 'Data Fetch',
          description: 'Read-only adapters',
          category: 'data',
          owner_privy_id: PRIVY_ID,
          owner_wallet: WALLET,
          endpoint: 'https://data.example/mcp',
          pricing: { type: 'free' },
          tools: [{ name: 'fx_rate', description: 'fx' }],
        }),
      }),
    );
    expect(listingRes.status).toBe(200);
    const listing = (await listingRes.json()) as { id: string };

    await rig.app.fetch(
      new Request(`http://test.local/v1/marketplace/listings/${listing.id}/status`, {
        method: 'PATCH',
        headers: admin(),
        body: JSON.stringify({ status: 'approved' }),
      }),
    );

    await rig.db.execute({
      sql: 'INSERT INTO platform_users (privy_id, wallet, email) VALUES (?, ?, ?)',
      args: [PRIVY_ID, WALLET, 'demo@leash.market'],
    });

    const agentRes = await rig.app.fetch(
      new Request('http://test.local/v1/platform/agents', {
        method: 'POST',
        headers: admin(),
        body: JSON.stringify({
          mint: MINT,
          treasury: TREASURY,
          owner_privy_id: PRIVY_ID,
          owner_wallet: WALLET,
          name: 'Demo Researcher',
          network: 'solana-devnet',
          model: 'claude-3-5-sonnet',
          system_prompt: 'You are a demo agent.',
          capabilities: [
            { slug: 'data-fetch', endpoint: 'https://data.example/mcp', tools: ['fx_rate'] },
          ],
          budget: { per_action: '0.10', per_task: '1.00', per_day: '5.00' },
          llm_provider: 'anthropic',
          llm_api_key: 'sk-ant-demo',
        }),
      }),
    );
    expect(agentRes.status).toBe(200);

    const taskRes = await rig.app.fetch(
      new Request('http://test.local/v1/platform/tasks', {
        method: 'POST',
        headers: admin(),
        body: JSON.stringify({
          agent_mint: MINT,
          prompt: 'Get the latest USD/EUR FX rate.',
          budget_cap: '0.50',
        }),
      }),
    );
    expect(taskRes.status).toBe(200);
    const task = (await taskRes.json()) as { id: string; status: string };
    expect(task.status).toBe('pending');

    const browse = await rig.app.fetch(new Request('http://test.local/v1/marketplace/listings'));
    const list = (await browse.json()) as { items: Array<{ slug: string }> };
    expect(list.items.map((i) => i.slug)).toContain('data-fetch');

    const stats = await rig.app.fetch(new Request('http://test.local/v1/stats/public'));
    expect(stats.status).toBe(200);
    const s = (await stats.json()) as { active_agents: number; active_listings: number };
    expect(s.active_agents).toBeGreaterThanOrEqual(1);
    expect(s.active_listings).toBeGreaterThanOrEqual(1);
  });
});
