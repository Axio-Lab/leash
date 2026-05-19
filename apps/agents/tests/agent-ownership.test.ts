import { describe, expect, it } from 'vitest';

import { loadAgentForOwner } from '../lib/agent-ownership';

describe('loadAgentForOwner', () => {
  it('allows the owner of a mint', async () => {
    const result = await loadAgentForOwner({
      mint: 'Mint11111111111111111111111111111111111',
      privyId: 'did:privy:owner',
      leashApiUrl: 'https://api.test',
      adminSecret: 'secret',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            mint: 'Mint11111111111111111111111111111111111',
            owner_privy_id: 'did:privy:owner',
          }),
        ),
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a cross-owner mint', async () => {
    const result = await loadAgentForOwner({
      mint: 'Mint11111111111111111111111111111111111',
      privyId: 'did:privy:owner',
      leashApiUrl: 'https://api.test',
      adminSecret: 'secret',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            mint: 'Mint11111111111111111111111111111111111',
            owner_privy_id: 'did:privy:other',
          }),
        ),
    });

    expect(result).toMatchObject({ ok: false, status: 403, error: 'forbidden' });
  });
});
