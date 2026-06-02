import { createHash, randomUUID } from 'node:crypto';

import type {
  CallerTrust,
  KoraAgent,
  KoraAgentCapability,
  KoraAgentPolicy,
  KoraExecution,
  KoraReceipt,
  KoraToolName,
  PolicyDecision,
} from './types.js';

export class InMemoryKoraAgentStore {
  private readonly agents = new Map<string, KoraAgent>();
  private readonly executions: KoraExecution[] = [];

  constructor(defaultAgent: {
    id: string;
    policy: KoraAgentPolicy;
    capabilities: KoraAgentCapability[];
  }) {
    const now = new Date().toISOString();
    this.agents.set(defaultAgent.id, {
      id: defaultAgent.id,
      name: 'Demo Kora Agent',
      description:
        'A local-currency Kora Agent that exposes Kora services to AI agents through Leash policy and receipts.',
      policy: defaultAgent.policy,
      capabilities: defaultAgent.capabilities,
      createdAt: now,
      updatedAt: now,
    });
  }

  createAgent(input: {
    id?: string;
    name: string;
    description?: string;
    policy: KoraAgentPolicy;
    capabilities: KoraAgentCapability[];
  }): KoraAgent {
    const now = new Date().toISOString();
    const id = input.id ?? slugify(input.name) ?? randomUUID();
    const agent: KoraAgent = {
      id,
      name: input.name,
      description: input.description ?? '',
      policy: input.policy,
      capabilities: input.capabilities,
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(id, agent);
    return agent;
  }

  getAgent(id: string): KoraAgent | null {
    return this.agents.get(id) ?? null;
  }

  listAgents(): KoraAgent[] {
    return [...this.agents.values()];
  }

  updatePolicy(id: string, policy: KoraAgentPolicy): KoraAgent | null {
    const agent = this.agents.get(id);
    if (!agent) return null;
    const updated = { ...agent, policy, updatedAt: new Date().toISOString() };
    this.agents.set(id, updated);
    return updated;
  }

  updateCapabilities(id: string, capabilities: KoraAgentCapability[]): KoraAgent | null {
    const agent = this.agents.get(id);
    if (!agent) return null;
    const updated = { ...agent, capabilities, updatedAt: new Date().toISOString() };
    this.agents.set(id, updated);
    return updated;
  }

  dailyTotal(agentId: string, currency: string | null, now = new Date()): number {
    if (!currency) return 0;
    const day = now.toISOString().slice(0, 10);
    return this.executions
      .filter(
        (execution) =>
          execution.agentId === agentId &&
          execution.status === 'ok' &&
          execution.tool === 'kora_create_payout' &&
          execution.currency === currency &&
          execution.createdAt.slice(0, 10) === day,
      )
      .reduce((sum, execution) => sum + (execution.amount ?? 0), 0);
  }

  recordExecution(input: {
    agentId: string;
    tool: KoraToolName;
    status: KoraExecution['status'];
    amount: number | null;
    currency: string | null;
    caller: CallerTrust;
    decision: PolicyDecision;
    koraReference: string | null;
    request: unknown;
    response: unknown;
  }): { execution: KoraExecution; receipt: KoraReceipt } {
    const now = new Date().toISOString();
    const receiptHash = receiptHashFor({ ...input, timestamp: now });
    const execution: KoraExecution = {
      id: randomUUID(),
      receiptHash,
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    this.executions.unshift(execution);
    return { execution, receipt: receiptForExecution(execution) };
  }

  listExecutions(agentId: string): KoraExecution[] {
    return this.executions.filter((execution) => execution.agentId === agentId);
  }

  updateFromWebhook(reference: string, payload: unknown): KoraExecution | null {
    const execution = this.executions.find((item) => item.koraReference === reference);
    if (!execution) return null;
    execution.status = 'webhook_updated';
    execution.response = payload;
    execution.updatedAt = new Date().toISOString();
    return execution;
  }
}

export function receiptForExecution(execution: KoraExecution): KoraReceipt {
  return {
    kind: 'kora_agent_rail_receipt',
    receipt_hash: execution.receiptHash,
    agent_id: execution.agentId,
    tool: execution.tool,
    decision: execution.decision.status,
    amount: execution.amount,
    currency: execution.currency,
    caller: {
      selector: execution.caller.selector,
      resolved_mint: execution.caller.resolvedMint,
      trust_status: execution.caller.status,
    },
    kora_reference: execution.koraReference,
    timestamp: execution.createdAt,
  };
}

function receiptHashFor(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function slugify(input: string): string | null {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}
