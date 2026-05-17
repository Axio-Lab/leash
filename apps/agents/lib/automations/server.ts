import type { AgentEvent } from '../agents/types';
import { DEFAULT_AGENT_SETTINGS, getAgentSettings } from '../agents/agent-settings';
import { runAgentTurn } from '../agents/brain';
import { defaultSkillFragments } from '../agents/default-skills';
import { getComposio } from '../composio';
import { getDb } from '../db';
import { getServerEnv, resolveAgentModel } from '../env';

import {
  buildAutomationPlannerPrompt,
  createDbPendingStore,
  parseDraftFromPlannerText,
  type AutomationApi,
  type AutomationDraft,
  type AutomationRunWire,
  type AutomationWire,
  type DraftPlannerInput,
  type ToolkitSummary,
} from './assistant';

async function upstreamJson<T>(input: string | URL, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.slice(0, 300) || `HTTP ${res.status}`);
  }
  return JSON.parse(text) as T;
}

export function createPlatformAutomationApi(): AutomationApi {
  const env = getServerEnv();
  const adminHeaders = {
    authorization: `Bearer ${env.leashApiAdminSecret}`,
  };

  function automationUrl(ownerPrivyId: string, id?: string): URL {
    const url = new URL(
      `${env.leashApiUrl}/v1/platform/automations${id ? `/${encodeURIComponent(id)}` : ''}`,
    );
    url.searchParams.set('owner_privy_id', ownerPrivyId);
    return url;
  }

  return {
    async listAutomations(ownerPrivyId) {
      const url = automationUrl(ownerPrivyId);
      const json = await upstreamJson<{ items: AutomationWire[] }>(url, {
        headers: adminHeaders,
      });
      return json.items;
    },
    async createAutomation(ownerPrivyId, draft) {
      return upstreamJson<AutomationWire>(`${env.leashApiUrl}/v1/platform/automations`, {
        method: 'POST',
        headers: {
          ...adminHeaders,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ owner_privy_id: ownerPrivyId, ...draft }),
      });
    },
    async patchAutomation(ownerPrivyId, id, patch) {
      return upstreamJson<AutomationWire>(automationUrl(ownerPrivyId, id), {
        method: 'PATCH',
        headers: {
          ...adminHeaders,
          'content-type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
    },
    async deleteAutomation(ownerPrivyId, id) {
      await upstreamJson<{ ok: boolean }>(automationUrl(ownerPrivyId, id), {
        method: 'DELETE',
        headers: adminHeaders,
      });
    },
    async listRuns(ownerPrivyId, automationId, limit = 5) {
      const url = new URL(
        `${env.leashApiUrl}/v1/platform/automations/${encodeURIComponent(automationId)}/runs`,
      );
      url.searchParams.set('owner_privy_id', ownerPrivyId);
      url.searchParams.set('limit', String(limit));
      const json = await upstreamJson<{ items: AutomationRunWire[] }>(url, {
        headers: adminHeaders,
      });
      return json.items;
    },
  };
}

export async function listConnectedToolkitsForOwner(privyId: string): Promise<ToolkitSummary[]> {
  const composio = getComposio();
  if (!composio) return [];
  try {
    const listed = await composio.connectedAccounts.list({
      userIds: [privyId],
      statuses: ['ACTIVE'],
    });
    const items = 'items' in listed ? listed.items : [];
    const out: ToolkitSummary[] = [];
    for (const row of items) {
      const r = row as {
        status?: string;
        toolkit?: { slug?: string; name?: string };
      };
      const slug = r.toolkit?.slug;
      if (!slug) continue;
      out.push({
        slug,
        name: r.toolkit?.name ?? slug,
        ...(r.status ? { status: r.status } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function planAutomationDraftWithAgent(
  input: DraftPlannerInput,
): Promise<Partial<AutomationDraft>> {
  const settings = await getAgentSettings(input.ownerPrivyId).catch(() => DEFAULT_AGENT_SETTINGS);
  const model = resolveAgentModel(settings.tier);
  const prompt = buildAutomationPlannerPrompt(input);
  const systemPrompt = [
    defaultSkillFragments(),
    'Automation planning mode: return a single JSON object matching the requested schema. Do not call tools. Do not include markdown.',
  ].join('\n\n');

  let text = '';
  const errors: string[] = [];
  const iter = runAgentTurn({
    privyId: input.ownerPrivyId,
    threadId: `automation-assistant:${input.channel}:${input.externalConnectionId ?? 'web'}`,
    agentMint: input.agentMint,
    userPrompt: prompt,
    model,
    systemPrompt,
    mcpServers: {},
  });
  for await (const ev of iter as AsyncIterable<AgentEvent>) {
    if (ev.type === 'token') text += ev.text;
    if (ev.type === 'error') errors.push(ev.message);
  }
  if (errors.length > 0 && text.trim().length === 0) {
    return {};
  }
  return parseDraftFromPlannerText(text);
}

export function createAutomationAssistantDeps(): {
  api: AutomationApi;
  pending: ReturnType<typeof createDbPendingStore>;
  planDraft: typeof planAutomationDraftWithAgent;
} {
  return {
    api: createPlatformAutomationApi(),
    pending: createDbPendingStore(getDb()),
    planDraft: planAutomationDraftWithAgent,
  };
}
