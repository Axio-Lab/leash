import { describe, expect, it } from 'vitest';

import { createTestRig } from './helpers.js';

const ADMIN_SECRET = 'a'.repeat(48); // >= 32 chars

describe('admin api-key endpoints', () => {
  it('returns 503 when admin secret is not configured on the server', async () => {
    const rig = await createTestRig();
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/admin/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_SECRET}` },
        body: JSON.stringify({ label: 'x', network: 'solana-devnet' }),
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('forbidden');
    expect(body.message).toMatch(/LEASH_API_ADMIN_SECRET/);
  });

  it('rejects requests without the admin secret', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/admin/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'x', network: 'solana-devnet' }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('missing admin secret');
  });

  it('rejects requests with the wrong admin secret', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const res = await rig.app.fetch(
      new Request('http://test.local/v1/admin/api-keys', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + 'b'.repeat(48),
        },
        body: JSON.stringify({ label: 'x', network: 'solana-devnet' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('issues, lists, and disables an API key end-to-end', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${ADMIN_SECRET}`,
    };

    const created = await rig.app.fetch(
      new Request('http://test.local/v1/admin/api-keys', {
        method: 'POST',
        headers,
        body: JSON.stringify({ label: 'integration', network: 'solana-devnet' }),
      }),
    );
    expect(created.status).toBe(200);
    const createBody = (await created.json()) as {
      key: { id: string; network: string; prefix: string; label: string };
      plaintext: string;
    };
    expect(createBody.key.label).toBe('integration');
    expect(createBody.key.network).toBe('solana-devnet');
    expect(createBody.plaintext.startsWith('lsh_test_')).toBe(true);

    // The freshly issued key should immediately authenticate against
    // a regular user-key endpoint.
    const userRes = await rig.app.fetch(
      new Request('http://test.local/v1/events', {
        headers: { authorization: `Bearer ${createBody.plaintext}` },
      }),
    );
    expect(userRes.status).toBe(200);

    const list = await rig.app.fetch(
      new Request('http://test.local/v1/admin/api-keys', { headers }),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { items: Array<{ id: string; label: string }> };
    expect(listBody.items.some((k) => k.label === 'integration')).toBe(true);

    const disabled = await rig.app.fetch(
      new Request(`http://test.local/v1/admin/api-keys/${createBody.key.id}/disable`, {
        method: 'POST',
        headers,
      }),
    );
    expect(disabled.status).toBe(200);
    const disabledBody = (await disabled.json()) as { key: { disabled_at: string | null } };
    expect(disabledBody.key.disabled_at).not.toBeNull();

    // After disable, the key can no longer authenticate.
    const after = await rig.app.fetch(
      new Request('http://test.local/v1/events', {
        headers: { authorization: `Bearer ${createBody.plaintext}` },
      }),
    );
    expect(after.status).toBe(401);
  });

  it('stores and lists owner_wallet when issuing a key', async () => {
    const rig = await createTestRig({ adminSecret: ADMIN_SECRET });
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${ADMIN_SECRET}`,
    };
    const wallet = 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd';

    const created = await rig.app.fetch(
      new Request('http://test.local/v1/admin/api-keys', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          label: 'wallet-owner',
          network: 'solana-devnet',
          owner_wallet: wallet,
        }),
      }),
    );
    expect(created.status).toBe(200);
    const createBody = (await created.json()) as {
      key: { id: string; owner_wallet: string | null };
    };
    expect(createBody.key.owner_wallet).toBe(wallet);

    const list = await rig.app.fetch(
      new Request(
        `http://test.local/v1/admin/api-keys?network=solana-devnet&owner_wallet=${encodeURIComponent(wallet)}`,
        { headers },
      ),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      items: Array<{ label: string; owner_wallet: string | null }>;
    };
    expect(
      listBody.items.some((k) => k.label === 'wallet-owner' && k.owner_wallet === wallet),
    ).toBe(true);
  });
});
