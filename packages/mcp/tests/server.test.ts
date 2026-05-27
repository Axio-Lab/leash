import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServerFromEnv } from '../src/server.js';

const CONFIG_ENV_KEYS = [
  'LEASH_AGENT_MINT',
  'LEASH_EXECUTIVE_KEY',
  'LEASH_NETWORK',
  'LEASH_API_URL',
  'LEASH_RPC_URL',
  'LEASH_API_KEY',
  'LEASH_PER_CALL_USDC',
  'LEASH_PER_DAY_USDC',
];

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of CONFIG_ENV_KEYS) out[k] = process.env[k];
  return out;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of CONFIG_ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe('@leashmarket/mcp server', () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    // Force "no agent" mode by clearing any developer-shell config.
    for (const k of CONFIG_ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it('boots without an agent and returns tools/list with all canonical tools', async () => {
    const { server, config } = buildServerFromEnv({
      configPath: '/nonexistent/path/agent.json',
    });
    expect(config).toBeNull();

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'leash-test-client', version: '0.0.1' },
      { capabilities: {} },
    );

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'leash_check_treasury_balance',
      'leash_create_agent_api_key',
      'leash_create_identity_claim',
      'leash_create_identity_disclosure',
      'leash_create_payment_link',
      'leash_daily_transactions',
      'leash_discover',
      'leash_get_identity',
      'leash_get_identity_profile',
      'leash_get_receipt',
      'leash_get_spend_limit',
      'leash_list_agent_api_keys',
      'leash_list_identity_disclosures',
      'leash_pay_payment_link',
      'leash_pay_skills_endpoints',
      'leash_receipts',
      'leash_register_agent',
      'leash_reputation',
      'leash_resolve_identity',
      'leash_revoke_agent_api_key',
      'leash_revoke_identity_claim',
      'leash_revoke_identity_disclosure',
      'leash_set_spend_limit',
      'leash_transaction_history',
      'leash_update_identity_profile',
      'leash_verify_identity',
      'leash_verify_identity_domain',
      'leash_withdraw_treasury',
    ]);

    await client.close();
    await server.close();
  });

  it('every tool short-circuits to status=no_agent when no config is loaded', async () => {
    const { server } = buildServerFromEnv({ configPath: '/nonexistent/path/agent.json' });

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'leash-test-client', version: '0.0.1' },
      { capabilities: {} },
    );
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: 'leash_check_treasury_balance',
      arguments: {},
    });
    const content = result.content as Array<{ type: string; text: string }> | undefined;
    expect(content?.[0]?.type).toBe('text');
    const parsed = JSON.parse(content![0]!.text) as {
      kind: string;
      status: string;
      message: string;
    };
    expect(parsed.kind).toBe('treasury_balance');
    expect(parsed.status).toBe('no_agent');
    expect(parsed.message).toMatch(/No Leash agent configured/);

    await client.close();
    await server.close();
  });

  it('leash_set_spend_limit + leash_get_spend_limit return no_agent when unconfigured', async () => {
    const { server } = buildServerFromEnv({ configPath: '/nonexistent/path/agent.json' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'leash-test-client', version: '0.0.1' },
      { capabilities: {} },
    );
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    for (const name of ['leash_set_spend_limit', 'leash_get_spend_limit'] as const) {
      const result = await client.callTool({ name, arguments: {} });
      const content = result.content as Array<{ type: string; text: string }> | undefined;
      const parsed = JSON.parse(content![0]!.text) as { kind: string; status: string };
      expect(parsed.kind).toBe('spend_limit');
      expect(parsed.status).toBe('no_agent');
    }

    await client.close();
    await server.close();
  });
});
