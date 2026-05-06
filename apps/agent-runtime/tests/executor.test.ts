import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret } from '@leashmarket/platform-auth/encryption';

import { executeTask } from '../src/executor.js';
import { runOnce } from '../src/loop.js';
import type { Publisher } from '../src/publisher.js';
import type { Agent, ActivityEnvelope, Task } from '../src/types.js';

const ENC = 'a'.repeat(64);

class CapturePublisher implements Publisher {
  events: ActivityEnvelope[] = [];
  async publish(env: ActivityEnvelope): Promise<void> {
    this.events.push(env);
  }
  async close(): Promise<void> {}
}

let db: Client;

async function setupDb() {
  db = createClient({ url: ':memory:' });
  await db.execute(`CREATE TABLE agents (
    mint TEXT PRIMARY KEY, owner_privy_id TEXT, owner_wallet TEXT, name TEXT,
    network TEXT CHECK (network IN ('solana-devnet','solana-mainnet')),
    model TEXT, system_prompt TEXT, capabilities TEXT,
    budget_per_action TEXT, budget_per_task TEXT, budget_per_day TEXT,
    treasury TEXT, service_key_id TEXT, encrypted_llm_key TEXT,
    llm_provider TEXT CHECK (llm_provider IN ('anthropic','openai')),
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT '2026-01-01T00:00:00.000Z'
  )`);
  await db.execute(`CREATE TABLE tasks (
    id TEXT PRIMARY KEY, agent_mint TEXT, prompt TEXT, budget_cap TEXT,
    status TEXT DEFAULT 'pending'
      CHECK (status IN ('pending','running','done','failed','out_of_budget')),
    spent TEXT DEFAULT '0', final_output TEXT, error TEXT,
    started_at TEXT, finished_at TEXT,
    created_at TEXT DEFAULT '2026-01-01T00:00:00.000Z'
  )`);
  await db.execute(`CREATE TABLE task_activities (
    id TEXT PRIMARY KEY, task_id TEXT, type TEXT,
    payload TEXT DEFAULT '{}', cost_usdc TEXT, receipt_id TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
}

beforeEach(setupDb);
afterEach(() => db.close());

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    mint: 'MINT',
    name: 'demo',
    ownerWallet: 'WALLET',
    network: 'solana-devnet',
    model: 'claude-3-5-sonnet',
    systemPrompt: 's',
    capabilities: [
      { slug: 'free-mcp', endpoint: 'https://free.example/mcp', tools: ['lookup'] },
      {
        slug: 'paid-mcp',
        endpoint: 'https://paid.example/mcp',
        tools: ['premium'],
        paid: true,
      },
    ],
    budget: { perAction: '0.10', perTask: '1.00', perDay: '10.00' },
    treasury: 'TREASURY',
    encryptedLlmKey: encryptSecret('sk-ant-x', ENC),
    llmProvider: 'anthropic',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK',
    agentMint: 'MINT',
    prompt: 'do thing',
    budgetCap: '1.00',
    status: 'running',
    spent: '0',
    ...overrides,
  };
}

async function seed(agent: Agent, task: Task) {
  await db.execute({
    sql: `INSERT INTO agents (
      mint, owner_privy_id, owner_wallet, name, network, model,
      system_prompt, capabilities,
      budget_per_action, budget_per_task, budget_per_day,
      treasury, service_key_id, encrypted_llm_key, llm_provider, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    args: [
      agent.mint,
      'priv',
      agent.ownerWallet,
      agent.name,
      agent.network,
      agent.model,
      agent.systemPrompt,
      JSON.stringify(agent.capabilities),
      agent.budget.perAction,
      agent.budget.perTask,
      agent.budget.perDay,
      agent.treasury,
      'KEY',
      agent.encryptedLlmKey,
      agent.llmProvider,
    ],
  });
  await db.execute({
    sql: `INSERT INTO tasks (id, agent_mint, prompt, budget_cap, status, spent)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [task.id, task.agentMint, task.prompt, task.budgetCap, task.status, task.spent],
  });
}

describe('executeTask', () => {
  it('emits think → tool_call → tool_result → done for a free-only agent', async () => {
    const agent = makeAgent({
      capabilities: [{ slug: 'free', endpoint: 'https://free.example/mcp', tools: ['lookup'] }],
    });
    const task = makeTask();
    await seed(agent, task);
    const pub = new CapturePublisher();
    const result = await executeTask({ db, publisher: pub, encryptionKey: ENC }, agent, task);
    expect(result.status).toBe('done');
    expect(result.spent).toBe('0.0000');
    const types = pub.events.map((e) => e.type);
    expect(types).toEqual(['think', 'tool_call', 'tool_result', 'done']);
  });

  it('emits a payment activity for paid tools and accrues spent', async () => {
    const agent = makeAgent();
    const task = makeTask();
    await seed(agent, task);
    const pub = new CapturePublisher();
    const result = await executeTask({ db, publisher: pub, encryptionKey: ENC }, agent, task);
    expect(result.status).toBe('done');
    expect(result.spent).toBe('0.1000');
    const types = pub.events.map((e) => e.type);
    // free first (sorted), then paid: think, tc, tr, tc, payment, tr, done
    expect(types).toEqual([
      'think',
      'tool_call',
      'tool_result',
      'tool_call',
      'payment',
      'tool_result',
      'done',
    ]);
  });

  it('aborts with out_of_budget when paid tool would exceed cap', async () => {
    const agent = makeAgent();
    const task = makeTask({ budgetCap: '0.05' }); // less than perAction
    await seed(agent, task);
    const pub = new CapturePublisher();
    const result = await executeTask({ db, publisher: pub, encryptionKey: ENC }, agent, task);
    expect(result.status).toBe('out_of_budget');
    const types = pub.events.map((e) => e.type);
    // free runs (0 cost), then paid hits budget gate before payment.
    expect(types.includes('payment')).toBe(false);
    expect(types[types.length - 1]).toBe('error');
  });

  it('marks the task failed when the encrypted LLM key cannot be decrypted', async () => {
    const agent = makeAgent({ encryptedLlmKey: 'v1:00:00:00' });
    const task = makeTask();
    await seed(agent, task);
    const pub = new CapturePublisher();
    const result = await executeTask({ db, publisher: pub, encryptionKey: ENC }, agent, task);
    expect(result.status).toBe('failed');
    expect(pub.events[0]!.type).toBe('error');
  });
});

describe('runOnce', () => {
  it('returns false when queue is empty', async () => {
    const pub = new CapturePublisher();
    const r = await runOnce({ db, publisher: pub, encryptionKey: ENC, pollMs: 1 });
    expect(r.ranTask).toBe(false);
  });

  it('claims and runs a pending task end-to-end', async () => {
    const agent = makeAgent({ capabilities: [] });
    const task = makeTask({ status: 'pending' });
    await seed(agent, task);
    const pub = new CapturePublisher();
    const r = await runOnce({ db, publisher: pub, encryptionKey: ENC, pollMs: 1 });
    expect(r.ranTask).toBe(true);
    const after = await db.execute({
      sql: 'SELECT status FROM tasks WHERE id = ?',
      args: ['TASK'],
    });
    expect(String(after.rows[0]!.status)).toBe('done');
    const events = pub.events.map((e) => e.type);
    expect(events[0]).toBe('think');
    expect(events[events.length - 1]).toBe('done');
  });

  it('marks task failed when agent is missing/disabled', async () => {
    await db.execute({
      sql: `INSERT INTO tasks (id, agent_mint, prompt, budget_cap, status, spent)
            VALUES ('orphan', 'NOPE', 'p', '1.00', 'pending', '0')`,
      args: [],
    });
    const pub = new CapturePublisher();
    const r = await runOnce({ db, publisher: pub, encryptionKey: ENC, pollMs: 1 });
    expect(r.ranTask).toBe(true);
    const after = await db.execute({
      sql: 'SELECT status FROM tasks WHERE id = ?',
      args: ['orphan'],
    });
    expect(String(after.rows[0]!.status)).toBe('failed');
  });
});
