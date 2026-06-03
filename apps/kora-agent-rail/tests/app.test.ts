import { describe, expect, it } from 'vitest';

import { createKoraAgentRailApp } from '../src/app.js';
import { buildCapabilities } from '../src/capabilities.js';
import { loadConfig } from '../src/config.js';
import type { KoraClient } from '../src/kora.js';
import { DemoTrustAdapter } from '../src/leash.js';
import { MemoryReceiptSink } from '../src/receipts.js';
import { InMemoryKoraAgentStore } from '../src/store.js';

function testDeps() {
  const config = loadConfig({
    KORA_PUBLIC_KEY: 'pk_test_unit',
    KORA_SECRET_KEY: 'sk_test_unit',
    KORA_AGENT_RAIL_PUBLIC_URL: 'http://localhost:4300',
    KORA_REQUIRE_LEASH: 'false',
    KORA_APPROVAL_THRESHOLD: '50000',
    KORA_MAX_PAYOUT_AMOUNT: '100000',
    KORA_DAILY_PAYOUT_LIMIT: '500000',
  });
  const calls: string[] = [];
  const virtualAccountInputs: unknown[] = [];
  const sandboxCreditInputs: unknown[] = [];
  const kora = {
    async getBalances() {
      calls.push('getBalances');
      return { status: true, data: { NGN: { available_balance: 100000 } } };
    },
    async listBanks(countryCode: string) {
      calls.push(`listBanks:${countryCode}`);
      return { status: true, data: [{ name: 'Access Bank', code: '044', country: countryCode }] };
    },
    async resolveBankAccount(input: unknown) {
      calls.push('resolveBankAccount');
      return { status: true, data: input };
    },
    async createPayout(input: Record<string, unknown>) {
      calls.push('createPayout');
      return { status: true, data: { reference: input.reference, status: 'processing' } };
    },
    async getPayoutStatus(reference: string) {
      calls.push(`getPayoutStatus:${reference}`);
      return { status: true, data: { reference, status: 'success' } };
    },
    async listPayouts() {
      calls.push('listPayouts');
      return { status: true, data: [] };
    },
    async createCheckout(input: unknown) {
      calls.push('createCheckout');
      return { status: true, data: input };
    },
    async createVirtualAccount(input: unknown) {
      calls.push('createVirtualAccount');
      virtualAccountInputs.push(input);
      return { status: true, data: input };
    },
    async creditSandboxVirtualAccount(input: unknown) {
      calls.push('creditSandboxVirtualAccount');
      sandboxCreditInputs.push(input);
      return { status: true, message: 'Virtual bank account credited successfully', data: input };
    },
  } as unknown as KoraClient;
  const receipts = new MemoryReceiptSink();
  const store = new InMemoryKoraAgentStore({
    id: config.defaultAgent.id,
    policy: config.defaultAgent.policy,
    capabilities: buildCapabilities(config.publicBaseUrl),
  });
  const app = createKoraAgentRailApp({
    config,
    kora,
    trust: new DemoTrustAdapter(),
    store,
    receipts,
  });
  return { app, calls, receipts, store, config, virtualAccountInputs, sandboxCreditInputs };
}

describe('Kora Agent Rail app', () => {
  it('exposes discovery without leaking Kora credentials', async () => {
    const { app } = testDeps();
    const ui = await app.request('http://localhost/');
    const uiText = await ui.text();
    expect(ui.status).toBe(200);
    expect(uiText).toContain('Kora Agent Rail');
    expect(uiText).toContain('Create Kora Agent');
    expect(uiText).toContain('List Banks');
    expect(uiText).toContain('Sandbox Payment');
    expect(uiText).toContain('data-payment-mode="virtualAccount"');
    expect(uiText).toContain('data-payment-mode="sandboxPayment"');
    expect(uiText).not.toContain('sk_test_unit');

    const openapi = await app.request('http://localhost/openapi.json');
    const openapiText = await openapi.text();
    expect(openapi.status).toBe(200);
    expect(openapiText).toContain('kora_create_payout');
    expect(openapiText).not.toContain('sk_test_unit');

    const llms = await app.request('http://localhost/llms.txt');
    const llmsText = await llms.text();
    expect(llmsText).toContain('Kora Agent Rail');
    expect(llmsText).not.toContain('sk_test_unit');
  });

  it('allows public bank discovery without a Kora API key from the caller', async () => {
    const { app, calls } = testDeps();
    const res = await app.request('http://localhost/tools/kora_list_banks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ country_code: 'NG' }),
    });
    const body = (await res.json()) as { status: string };

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(calls).toEqual(['listBanks:NG']);
  });

  it('creates an in-limit local-currency payout and records a receipt', async () => {
    const { app, calls, receipts } = testDeps();
    const res = await app.request('http://localhost/tools/kora_create_payout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-leash-agent': 'agent-mint',
      },
      body: JSON.stringify({
        reference: 'INV-1042',
        amount: 25000,
        currency: 'NGN',
        destination: {
          type: 'bank_account',
          bank_account: { bank: '044', account: '0000000000' },
          customer: { email: 'ada@example.com' },
        },
      }),
    });
    const body = (await res.json()) as {
      status: string;
      receipt: { kora_reference: string };
    };

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.receipt.kora_reference).toBe('INV-1042');
    expect(calls).toContain('createPayout');
    expect(receipts.receipts).toHaveLength(1);
  });

  it('does not call Kora when policy requires approval', async () => {
    const { app, calls } = testDeps();
    const res = await app.request('http://localhost/tools/kora_create_payout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-leash-agent': 'agent-mint',
      },
      body: JSON.stringify({
        reference: 'INV-APPROVAL',
        amount: 75000,
        currency: 'NGN',
        destination: {
          type: 'bank_account',
          bank_account: { bank: '044', account: '0000000000' },
          customer: { email: 'ada@example.com' },
        },
      }),
    });
    const body = (await res.json()) as { status: string };

    expect(res.status).toBe(202);
    expect(body.status).toBe('approval_required');
    expect(calls).not.toContain('createPayout');
  });

  it('updates an execution from a Kora payout webhook', async () => {
    const { app, store, config } = testDeps();
    await app.request('http://localhost/tools/kora_create_payout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-leash-agent': 'agent-mint',
      },
      body: JSON.stringify({
        reference: 'INV-WEBHOOK',
        amount: 25000,
        currency: 'NGN',
        destination: {
          type: 'bank_account',
          bank_account: { bank: '044', account: '0000000000' },
          customer: { email: 'ada@example.com' },
        },
      }),
    });

    const res = await app.request('http://localhost/kora/webhooks/payout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'transfer.success',
        data: { reference: 'INV-WEBHOOK', status: 'success' },
      }),
    });
    const body = (await res.json()) as { status: string };
    const executions = store.listExecutions(config.defaultAgent.id);

    expect(res.status).toBe(200);
    expect(body.status).toBe('updated');
    expect(executions[0]!.status).toBe('webhook_updated');
  });

  it('forwards Kora-required virtual account fields', async () => {
    const { app, virtualAccountInputs } = testDeps();
    const res = await app.request('http://localhost/tools/kora_create_virtual_account', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-leash-agent': 'agent-mint',
      },
      body: JSON.stringify({
        account_name: 'Leash Demo Customer',
        account_reference: 'leash-demo-va-001',
        permanent: true,
        bank_code: '000',
        currency: 'NGN',
        customer: { name: 'Leash Demo Customer', email: 'demo@leash.market' },
        kyc: { bvn: '22222222222' },
      }),
    });
    const body = (await res.json()) as {
      status: string;
      receipt: { kora_reference: string };
    };

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.receipt.kora_reference).toBe('leash-demo-va-001');
    expect(virtualAccountInputs[0]).toMatchObject({
      account_name: 'Leash Demo Customer',
      account_reference: 'leash-demo-va-001',
      permanent: true,
      bank_code: '000',
      currency: 'NGN',
      customer: { name: 'Leash Demo Customer', email: 'demo@leash.market' },
      kyc: { bvn: '22222222222' },
    });
  });

  it('credits a sandbox virtual account and records the account number reference', async () => {
    const { app, sandboxCreditInputs } = testDeps();
    const res = await app.request('http://localhost/tools/kora_credit_sandbox_virtual_account', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-leash-agent': 'agent-mint',
      },
      body: JSON.stringify({
        account_number: '1110033387',
        amount: '1000',
        currency: 'NGN',
      }),
    });
    const body = (await res.json()) as {
      status: string;
      receipt: { kora_reference: string; amount: number; currency: string };
    };

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.receipt.kora_reference).toBe('1110033387');
    expect(body.receipt.amount).toBe(1000);
    expect(body.receipt.currency).toBe('NGN');
    expect(sandboxCreditInputs[0]).toMatchObject({
      account_number: '1110033387',
      amount: 1000,
      currency: 'NGN',
    });
  });
});
