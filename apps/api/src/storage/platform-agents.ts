/**
 * Storage helpers for the platform `agents` table (v7 schema). Mirrors
 * the existing storage modules: typed CRUD over libsql, no business
 * logic, no auth.
 *
 * "platform" prefix avoids confusion with the chain-side `agents.ts`
 * routes that prepare on-chain identity transactions.
 */

import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import type { SvmNetwork } from '../util/network.js';

export type LlmProvider = 'anthropic' | 'openai' | 'platform';

export type Capability = {
  /** Marketplace listing slug, or `null` for ad-hoc / direct URL entries. */
  slug: string | null;
  endpoint: string;
  /** Tool names exposed by the MCP. The runtime calls `tools/list` to refresh. */
  tools: string[];
  /** Whether the agent paid for this on add (paid listings) — informational. */
  paid?: boolean;
};

export type AgentBudget = {
  perAction: string;
  perTask: string;
  perDay: string;
};

export type PlatformAgentRow = {
  mint: string;
  ownerPrivyId: string;
  ownerWallet: string;
  name: string;
  network: SvmNetwork;
  model: string;
  systemPrompt: string;
  capabilities: Capability[];
  budget: AgentBudget;
  treasury: string;
  serviceKeyId: string;
  encryptedLlmKey: string;
  llmProvider: LlmProvider;
  status: 'active' | 'disabled';
  createdAt: string;
};

function rowToAgent(row: Record<string, unknown>): PlatformAgentRow {
  let capabilities: Capability[] = [];
  try {
    const parsed = JSON.parse(String(row.capabilities ?? '[]'));
    if (Array.isArray(parsed)) capabilities = parsed as Capability[];
  } catch {
    capabilities = [];
  }
  const network = String(row.network);
  if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
    throw new Error(`unexpected network in agents: ${network}`);
  }
  const provider = String(row.llm_provider);
  if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'platform') {
    throw new Error(`unexpected llm_provider in agents: ${provider}`);
  }
  const status = String(row.status);
  if (status !== 'active' && status !== 'disabled') {
    throw new Error(`unexpected status in agents: ${status}`);
  }
  return {
    mint: String(row.mint),
    ownerPrivyId: String(row.owner_privy_id),
    ownerWallet: String(row.owner_wallet),
    name: String(row.name),
    network,
    model: String(row.model),
    systemPrompt: String(row.system_prompt),
    capabilities,
    budget: {
      perAction: String(row.budget_per_action),
      perTask: String(row.budget_per_task),
      perDay: String(row.budget_per_day),
    },
    treasury: String(row.treasury),
    serviceKeyId: String(row.service_key_id),
    encryptedLlmKey: String(row.encrypted_llm_key),
    llmProvider: provider,
    status,
    createdAt: String(row.created_at),
  };
}

export async function createPlatformAgent(
  db: DbClient,
  row: Omit<PlatformAgentRow, 'createdAt' | 'status'> & { status?: 'active' | 'disabled' },
): Promise<PlatformAgentRow> {
  await execute(
    db,
    `INSERT INTO agents (
      mint, owner_privy_id, owner_wallet, name, network, model,
      system_prompt, capabilities,
      budget_per_action, budget_per_task, budget_per_day,
      treasury, service_key_id, encrypted_llm_key, llm_provider, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.mint,
      row.ownerPrivyId,
      row.ownerWallet,
      row.name,
      row.network,
      row.model,
      row.systemPrompt,
      JSON.stringify(row.capabilities ?? []),
      row.budget.perAction,
      row.budget.perTask,
      row.budget.perDay,
      row.treasury,
      row.serviceKeyId,
      row.encryptedLlmKey,
      row.llmProvider,
      row.status ?? 'active',
    ],
  );
  const created = await getPlatformAgent(db, row.mint);
  if (!created) throw new Error('agents insert succeeded but lookup failed');
  return created;
}

export async function getPlatformAgent(
  db: DbClient,
  mint: string,
): Promise<PlatformAgentRow | null> {
  const res = await execute(db, `SELECT * FROM agents WHERE mint = ? LIMIT 1`, [mint]);
  const row = res.rows[0];
  if (!row) return null;
  return rowToAgent(row as Record<string, unknown>);
}

export async function listPlatformAgentsForOwner(
  db: DbClient,
  ownerPrivyId: string,
): Promise<PlatformAgentRow[]> {
  const res = await execute(
    db,
    `SELECT * FROM agents WHERE owner_privy_id = ? AND status = 'active' ORDER BY created_at DESC`,
    [ownerPrivyId],
  );
  return res.rows.map((r) => rowToAgent(r as Record<string, unknown>));
}

export async function updatePlatformAgentCapabilities(
  db: DbClient,
  mint: string,
  capabilities: Capability[],
): Promise<void> {
  await execute(db, `UPDATE agents SET capabilities = ? WHERE mint = ?`, [
    JSON.stringify(capabilities),
    mint,
  ]);
}

export async function disablePlatformAgent(db: DbClient, mint: string): Promise<void> {
  await execute(db, `UPDATE agents SET status = 'disabled' WHERE mint = ?`, [mint]);
}
