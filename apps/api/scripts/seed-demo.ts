/**
 * Seed a self-contained demo flow:
 *   1. create one demo platform user
 *   2. mint a service `lsh_*` key for the agent
 *   3. record a demo `agents` row pre-wired with seed capabilities so
 *      the explorer + dashboard show a populated agent out of the box
 *   4. enqueue three pending tasks the agent-runtime can pick up
 *
 * No marketplace listings are seeded — the Favorites page surfaces the
 * Solana Foundation pay-skills catalogue automatically, and real Leash
 * listings populate as sellers register.
 *
 * Idempotent: skips anything already present.
 *
 * Usage:
 *   pnpm --filter @leashmarket/api db:migrate
 *   pnpm --filter @leashmarket/api seed:demo
 */

import { createClient } from '@libsql/client';

import { encryptSecret } from '@leashmarket/platform-auth/encryption';

import {
  createPlatformAgent,
  getPlatformAgent,
  type Capability,
} from '../src/storage/platform-agents.js';
import { createApiKey } from '../src/storage/api-keys.js';
import { createTask, listTasksForAgent } from '../src/storage/platform-tasks.js';
import { execute } from '../src/storage/turso.js';

const DEMO_PRIVY_ID = 'did:privy:demo';
const DEMO_WALLET = '11111111111111111111111111111111';
const DEMO_TREASURY = 'TreasuryDemo111111111111111111111111111';
const DEMO_AGENT_MINT = 'AgentDemo11111111111111111111111111111';

function getEncryptionKey(): string {
  const k = process.env.ENCRYPTION_KEY?.trim() ?? '';
  if (k.length === 0) {
    // Deterministic, throw-away key only for seed runs without a real
    // ENCRYPTION_KEY in env. Never appears in production.
    return '0'.repeat(64);
  }
  return k;
}

const url = (process.env.LEASH_DB_URL || process.env.LEASH_API_DB_URL || '').trim();
const authToken = (
  process.env.LEASH_DB_AUTH_TOKEN ||
  process.env.LEASH_API_DB_AUTH_TOKEN ||
  ''
).trim();
if (!url) throw new Error('Set LEASH_DB_URL or LEASH_API_DB_URL');

const db = createClient({ url, ...(authToken ? { authToken } : {}) });

await execute(
  db,
  `INSERT OR IGNORE INTO platform_users (privy_id, wallet, email)
   VALUES (?, ?, ?)`,
  [DEMO_PRIVY_ID, DEMO_WALLET, 'demo@leash.market'],
);

let agent = await getPlatformAgent(db, DEMO_AGENT_MINT);
let serviceKeyId: string;

if (agent) {
  serviceKeyId = agent.serviceKeyId;
} else {
  const issued = await createApiKey(db, {
    label: 'demo agent service',
    network: 'solana-devnet',
    ownerWallet: DEMO_WALLET,
    scopes: ['agents'],
  });
  serviceKeyId = issued.key.id;

  // Demo agent ships without pre-bound capabilities — the chat brain
  // surfaces real services through `leash_discover` (Leash + pay-skills)
  // at runtime, and Composio tools attach via the OAuth flow on
  // /settings/connections. Keep this empty so re-seeding never
  // resurrects fabricated `*.demo.leash.market` endpoints.
  const capabilities: Capability[] = [];

  agent = await createPlatformAgent(db, {
    mint: DEMO_AGENT_MINT,
    ownerPrivyId: DEMO_PRIVY_ID,
    ownerWallet: DEMO_WALLET,
    name: 'Solana Researcher',
    description: 'Demo research agent that uses marketplace tools to answer questions.',
    imageUrl: null,
    services: [],
    network: 'solana-devnet',
    model: 'claude-3-5-sonnet',
    systemPrompt:
      'You are a research assistant. Use the marketplace tools to answer questions. Cite sources where possible.',
    capabilities,
    budget: { perAction: '0.10', perTask: '1.00', perDay: '5.00' },
    treasury: DEMO_TREASURY,
    serviceKeyId,
    encryptedLlmKey: encryptSecret('demo-llm-key', getEncryptionKey()),
    llmProvider: 'anthropic',
  });
}

const existing = await listTasksForAgent(db, DEMO_AGENT_MINT);
const existingPrompts = new Set(existing.map((t) => t.prompt));

const demoTasks = [
  'What is the current USDC price and the FX rate of USD/EUR? Summarise both in two short sentences.',
  'Search the web for the latest Solana TPS record and return the source URL.',
  'Fetch the current weather at coordinates 40.7128,-74.0060 and explain whether it is good for biking.',
];

for (const prompt of demoTasks) {
  if (existingPrompts.has(prompt)) continue;
  await createTask(db, {
    agentMint: DEMO_AGENT_MINT,
    prompt,
    budgetCap: '0.50',
  });
}

// eslint-disable-next-line no-console
console.log(`[seed-demo] agent=${agent!.mint} service_key=${serviceKeyId}`);
// eslint-disable-next-line no-console
console.log(`[seed-demo] demo tasks queued: ${demoTasks.length}`);
