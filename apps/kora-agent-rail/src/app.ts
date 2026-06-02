import { Hono } from 'hono';
import { z } from 'zod';

import { buildCapabilities, isPublicTool } from './capabilities.js';
import type { AppConfig } from './config.js';
import { KoraClient } from './kora.js';
import type { TrustAdapter } from './leash.js';
import { evaluatePolicy } from './policy.js';
import type { ReceiptSink } from './receipts.js';
import { InMemoryKoraAgentStore } from './store.js';
import type {
  CallerSelector,
  KoraAgent,
  KoraAgentCapability,
  KoraAgentPolicy,
  KoraToolName,
  KoraToolResult,
} from './types.js';

export type KoraAgentRailDeps = {
  config: AppConfig;
  kora: KoraClient;
  trust: TrustAdapter;
  store: InMemoryKoraAgentStore;
  receipts: ReceiptSink;
};

const AgentIdSchema = z.object({ agent_id: z.string().min(1).optional() });
const CountrySchema = AgentIdSchema.extend({
  country_code: z.string().min(2).max(2).default('NG'),
});
const AmountSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount must be numeric' });
    return z.NEVER;
  }
  return parsed;
});
const PayoutSchema = AgentIdSchema.extend({
  reference: z.string().min(5).optional(),
  amount: AmountSchema,
  currency: z
    .string()
    .min(3)
    .max(3)
    .transform((value) => value.toUpperCase()),
  destination: z.record(z.unknown()),
  narration: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
const ResolveBankSchema = AgentIdSchema.extend({
  bank: z.string().min(1),
  account: z.string().min(1),
  currency: z.string().min(3).max(3).default('NGN'),
});
const PayoutStatusSchema = AgentIdSchema.extend({
  transaction_reference: z.string().min(1),
});
const ListPayoutsSchema = AgentIdSchema.extend({
  limit: z.number().int().positive().max(100).optional(),
  currency: z.string().min(3).max(3).optional(),
});
const CheckoutSchema = AgentIdSchema.extend({
  reference: z.string().min(5).optional(),
  amount: AmountSchema,
  currency: z
    .string()
    .min(3)
    .max(3)
    .transform((value) => value.toUpperCase()),
  customer: z.record(z.unknown()),
  redirect_url: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});
const VirtualAccountSchema = AgentIdSchema.extend({
  account_name: z.string().min(1).optional(),
  customer: z.record(z.unknown()).optional(),
  permanent: z.boolean().optional(),
  bank_code: z.string().optional(),
  currency: z.string().min(3).max(3).default('NGN'),
  reference: z.string().min(5).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ToolNameSchema = z.enum([
  'kora_get_agent_capabilities',
  'kora_get_balance',
  'kora_list_banks',
  'kora_resolve_bank_account',
  'kora_create_payout',
  'kora_get_payout_status',
  'kora_list_payouts',
  'kora_create_checkout',
  'kora_create_virtual_account',
]);

const PolicySchema = z.object({
  allowedCapabilities: z.array(z.string()).transform((items) => items as KoraToolName[]),
  allowedCurrencies: z.array(
    z
      .string()
      .min(3)
      .max(3)
      .transform((value) => value.toUpperCase()),
  ),
  requireVerifiedAgent: z.boolean(),
  allowedCallers: z.object({
    mints: z.array(z.string()),
    handles: z.array(z.string()),
    domains: z.array(z.string()),
  }),
  maxPayoutAmount: z.number().positive(),
  dailyPayoutLimit: z.number().positive(),
  approvalThreshold: z.number().nonnegative(),
});

const CapabilitySchema = z.object({
  name: ToolNameSchema,
  title: z.string(),
  description: z.string(),
  endpoint: z.string().url(),
  localCurrency: z.boolean(),
  moneyMovement: z.boolean(),
});

const CreateAgentSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  policy: PolicySchema.optional(),
  capabilities: z.array(CapabilitySchema).optional(),
});

export function createKoraAgentRailApp(deps: KoraAgentRailDeps): Hono {
  const app = new Hono();
  const defaultAgentId = deps.config.defaultAgent.id;

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'kora-agent-rail',
      default_agent_id: defaultAgentId,
      leash_required: deps.config.leash.requireLeash,
    }),
  );

  app.get('/llms.txt', (c) =>
    c.text(buildLlmsTxt(deps.config.publicBaseUrl, deps.store.getAgent(defaultAgentId))),
  );

  app.get('/openapi.json', (c) => c.json(buildOpenApi(deps.config.publicBaseUrl)));

  app.get('/.well-known/leash-mcp.json', (c) =>
    c.json(buildMcpManifest(deps.config.publicBaseUrl)),
  );

  app.get('/mcp', (c) => c.json({ tools: toolDefinitions(deps.config.publicBaseUrl) }));

  app.post('/mcp', async (c) => {
    const { body, bodyText } = await readJsonRequest(c.req.raw);
    const rpc = JsonRpcSchema.safeParse(body);
    if (!rpc.success) {
      return c.json(jsonRpcError(null, -32_600, 'Invalid JSON-RPC request'), 400);
    }
    const { id, method, params } = rpc.data;
    if (method === 'initialize') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'kora-agent-rail', version: '0.1.0' },
          capabilities: { tools: {} },
        },
      });
    }
    if (method === 'tools/list') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: { tools: toolDefinitions(deps.config.publicBaseUrl) },
      });
    }
    if (method === 'tools/call') {
      const parsed = ToolCallSchema.safeParse(params);
      if (!parsed.success) {
        return c.json(jsonRpcError(id, -32_602, 'Invalid tools/call params'), 400);
      }
      const result = await executeTool(
        deps,
        c.req.raw,
        bodyText,
        parsed.data.name,
        parsed.data.arguments,
      );
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: result.status === 'error' || result.status === 'denied',
        },
      });
    }
    return c.json(jsonRpcError(id, -32_601, `Unknown method ${method}`), 404);
  });

  app.get('/kora-agents', (c) => c.json({ items: deps.store.listAgents() }));

  app.post('/kora-agents', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = CreateAgentSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const baseAgent = deps.store.getAgent(defaultAgentId);
    const agent = deps.store.createAgent({
      ...parsed.data,
      policy: (parsed.data.policy ??
        baseAgent?.policy ??
        deps.config.defaultAgent.policy) as KoraAgentPolicy,
      capabilities: (parsed.data.capabilities ??
        baseAgent?.capabilities ??
        buildCapabilities(deps.config.publicBaseUrl)) as KoraAgentCapability[],
    });
    return c.json(agent, 201);
  });

  app.get('/kora-agents/:id', (c) => {
    const agent = deps.store.getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Kora Agent not found' }, 404);
    return c.json(agent);
  });

  app.put('/kora-agents/:id/policy', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = PolicySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const agent = deps.store.updatePolicy(c.req.param('id'), parsed.data as KoraAgentPolicy);
    if (!agent) return c.json({ error: 'Kora Agent not found' }, 404);
    return c.json(agent);
  });

  app.put('/kora-agents/:id/capabilities', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.array(CapabilitySchema).safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const agent = deps.store.updateCapabilities(
      c.req.param('id'),
      parsed.data as KoraAgentCapability[],
    );
    if (!agent) return c.json({ error: 'Kora Agent not found' }, 404);
    return c.json(agent);
  });

  app.post('/kora-agents/:id/publish', (c) => {
    const agent = deps.store.getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Kora Agent not found' }, 404);
    return c.json({
      status: 'published',
      agent,
      manifest_url: `${deps.config.publicBaseUrl}/.well-known/leash-mcp.json`,
      openapi_url: `${deps.config.publicBaseUrl}/openapi.json`,
      llms_url: `${deps.config.publicBaseUrl}/llms.txt`,
    });
  });

  app.get('/kora-agents/:id/executions', (c) => {
    const agent = deps.store.getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Kora Agent not found' }, 404);
    return c.json({ items: deps.store.listExecutions(agent.id) });
  });

  app.get('/agents/:id/capabilities', (c) => {
    const agent = deps.store.getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Kora Agent not found' }, 404);
    return c.json({ agent_id: agent.id, capabilities: agent.capabilities });
  });

  app.post('/kora/webhooks/payout', async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    const reference = referenceFromWebhook(payload);
    if (!reference) return c.json({ status: 'ignored', reason: 'missing payout reference' }, 202);
    const execution = deps.store.updateFromWebhook(reference, payload);
    return c.json({
      status: execution ? 'updated' : 'not_found',
      reference,
      execution_id: execution?.id ?? null,
    });
  });

  for (const tool of toolNames()) {
    app.post(`/tools/${tool}`, async (c) => {
      const { body, bodyText } = await readJsonRequest(c.req.raw);
      const result = await executeTool(deps, c.req.raw, bodyText, tool, body);
      return c.json(result, statusCodeFor(result));
    });
  }

  return app;
}

const JsonRpcSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

const ToolCallSchema = z.object({
  name: z.string().transform((value) => value as KoraToolName),
  arguments: z.unknown().optional(),
});

async function executeTool(
  deps: KoraAgentRailDeps,
  request: Request,
  bodyText: string | undefined,
  tool: KoraToolName,
  input: unknown,
): Promise<KoraToolResult> {
  const normalizedInput = input ?? {};
  const agentId = readAgentId(normalizedInput) ?? deps.config.defaultAgent.id;
  const agent = deps.store.getAgent(agentId);
  if (!agent) return errorResult(deps, agentId, tool, 'Kora Agent not found', normalizedInput);

  const parsed = parseToolInput(tool, normalizedInput);
  if (!parsed.ok) return errorResult(deps, agentId, tool, parsed.message, normalizedInput);

  const publicTool = isPublicTool(tool);
  const requestUrl = new URL(request.url);
  const caller = await deps.trust.verifyCaller({
    selector: callerSelectorFromHeaders(request.headers),
    publicTool,
    method: request.method,
    pathWithQuery: requestUrl.pathname + requestUrl.search,
    bodyText,
    headers: request.headers,
  });
  const amount = toolAmount(tool, parsed.value);
  const currency = toolCurrency(tool, parsed.value);
  const decision = evaluatePolicy({
    agent,
    tool,
    caller,
    publicTool,
    ...(amount == null ? {} : { amount }),
    ...(currency == null ? {} : { currency }),
    currentDailyTotal: deps.store.dailyTotal(agent.id, currency ?? null),
  });

  if (decision.status !== 'allowed') {
    const { receipt } = deps.store.recordExecution({
      agentId: agent.id,
      tool,
      status: decision.status === 'denied' ? 'denied' : 'approval_required',
      amount: amount ?? null,
      currency: currency ?? null,
      caller,
      decision,
      koraReference: null,
      request: redactToolInput(parsed.value),
      response: null,
    });
    await safeRecordReceipt(deps.receipts, receipt);
    return {
      kind: 'kora_tool_result',
      status: decision.status === 'denied' ? 'denied' : 'approval_required',
      agent_id: agent.id,
      tool,
      decision,
      receipt,
    };
  }

  try {
    const data =
      tool === 'kora_get_agent_capabilities'
        ? { capabilities: agent.capabilities }
        : await callKora(deps.kora, tool, parsed.value);
    const koraReference = referenceFromResponse(data) ?? referenceFromInput(parsed.value);
    const { receipt } = deps.store.recordExecution({
      agentId: agent.id,
      tool,
      status: 'ok',
      amount: amount ?? null,
      currency: currency ?? null,
      caller,
      decision,
      koraReference,
      request: redactToolInput(parsed.value),
      response: data,
    });
    await safeRecordReceipt(deps.receipts, receipt);
    return {
      kind: 'kora_tool_result',
      status: 'ok',
      agent_id: agent.id,
      tool,
      decision,
      receipt,
      data,
    };
  } catch (err) {
    const { receipt } = deps.store.recordExecution({
      agentId: agent.id,
      tool,
      status: 'error',
      amount: amount ?? null,
      currency: currency ?? null,
      caller,
      decision,
      koraReference: null,
      request: redactToolInput(parsed.value),
      response: { error: safeErrorMessage(err) },
    });
    await safeRecordReceipt(deps.receipts, receipt);
    return {
      kind: 'kora_tool_result',
      status: 'error',
      agent_id: agent.id,
      tool,
      decision,
      receipt,
      error: { message: safeErrorMessage(err) },
    };
  }
}

function parseToolInput(
  tool: KoraToolName,
  input: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const schema = schemaForTool(tool);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: JSON.stringify(parsed.error.flatten()) };
  return { ok: true, value: parsed.data as Record<string, unknown> };
}

function schemaForTool(tool: KoraToolName): z.ZodTypeAny {
  switch (tool) {
    case 'kora_get_agent_capabilities':
    case 'kora_get_balance':
      return AgentIdSchema;
    case 'kora_list_banks':
      return CountrySchema;
    case 'kora_resolve_bank_account':
      return ResolveBankSchema;
    case 'kora_create_payout':
      return PayoutSchema;
    case 'kora_get_payout_status':
      return PayoutStatusSchema;
    case 'kora_list_payouts':
      return ListPayoutsSchema;
    case 'kora_create_checkout':
      return CheckoutSchema;
    case 'kora_create_virtual_account':
      return VirtualAccountSchema;
  }
}

async function callKora(
  kora: KoraClient,
  tool: KoraToolName,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (tool) {
    case 'kora_get_agent_capabilities':
      return { capabilities: [] };
    case 'kora_get_balance':
      return kora.getBalances();
    case 'kora_list_banks':
      return kora.listBanks(String(input.country_code ?? 'NG'));
    case 'kora_resolve_bank_account':
      return kora.resolveBankAccount({
        bank: input.bank,
        account: input.account,
        currency: input.currency,
      });
    case 'kora_create_payout':
      return kora.createPayout({
        reference: input.reference ?? `kora-agent-${crypto.randomUUID()}`,
        destination: input.destination,
        amount: input.amount,
        currency: input.currency,
        narration: input.narration,
        metadata: input.metadata,
      });
    case 'kora_get_payout_status':
      return kora.getPayoutStatus(String(input.transaction_reference));
    case 'kora_list_payouts':
      return kora.listPayouts({
        limit: typeof input.limit === 'number' ? input.limit : undefined,
        currency: typeof input.currency === 'string' ? input.currency : undefined,
      });
    case 'kora_create_checkout':
      return kora.createCheckout({
        reference: input.reference ?? `kora-checkout-${crypto.randomUUID()}`,
        amount: input.amount,
        currency: input.currency,
        customer: input.customer,
        redirect_url: input.redirect_url,
        metadata: input.metadata,
      });
    case 'kora_create_virtual_account':
      return kora.createVirtualAccount({
        account_name: input.account_name,
        customer: input.customer,
        permanent: input.permanent,
        bank_code: input.bank_code,
        currency: input.currency,
        reference: input.reference,
        metadata: input.metadata,
      });
  }
}

function callerSelectorFromHeaders(headers: Headers): CallerSelector | null {
  const mint = headers.get('x-leash-agent') ?? headers.get('x-agent-mint');
  const handle = headers.get('x-leash-handle') ?? headers.get('x-agent-handle');
  const domain = headers.get('x-leash-domain') ?? headers.get('x-agent-domain');
  const selector: CallerSelector = {};
  if (mint) selector.mint = mint;
  if (handle) selector.handle = handle;
  if (domain) selector.domain = domain;
  return Object.keys(selector).length > 0 ? selector : null;
}

async function readJsonRequest(request: Request): Promise<{
  bodyText: string | undefined;
  body: unknown;
}> {
  const bodyText = await request.text();
  if (!bodyText) return { bodyText: undefined, body: {} };
  try {
    return { bodyText, body: JSON.parse(bodyText) as unknown };
  } catch {
    return { bodyText, body: {} };
  }
}

function readAgentId(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const raw = (input as Record<string, unknown>).agent_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function toolAmount(tool: KoraToolName, input: Record<string, unknown>): number | null {
  return tool === 'kora_create_payout' || tool === 'kora_create_checkout'
    ? typeof input.amount === 'number'
      ? input.amount
      : null
    : null;
}

function toolCurrency(tool: KoraToolName, input: Record<string, unknown>): string | null {
  return tool === 'kora_create_payout' || tool === 'kora_create_checkout'
    ? typeof input.currency === 'string'
      ? input.currency
      : null
    : null;
}

function statusCodeFor(result: KoraToolResult): 200 | 202 | 400 | 403 | 502 {
  if (result.status === 'ok') return 200;
  if (result.status === 'approval_required') return 202;
  if (result.status === 'denied') return 403;
  return 502;
}

async function safeRecordReceipt(receipts: ReceiptSink, receipt: KoraToolResult['receipt']) {
  try {
    await receipts.record(receipt);
  } catch {
    // Receipt mirroring should not expose or block the Kora response path.
  }
}

function errorResult(
  deps: KoraAgentRailDeps,
  agentId: string,
  tool: KoraToolName,
  message: string,
  input: unknown,
): KoraToolResult {
  const caller = {
    status: 'missing' as const,
    verified: false,
    selector: null,
    resolvedMint: null,
    detail: 'request did not reach trust verification',
  };
  const decision = { status: 'denied' as const, reason: message, checks: [] };
  const { receipt } = deps.store.recordExecution({
    agentId,
    tool,
    status: 'error',
    amount: null,
    currency: null,
    caller,
    decision,
    koraReference: null,
    request: redactToolInput(input),
    response: { error: message },
  });
  return {
    kind: 'kora_tool_result',
    status: 'error',
    agent_id: agentId,
    tool,
    decision,
    receipt,
    error: { message },
  };
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_***');
  return 'Kora call failed';
}

function redactToolInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const copy = structuredClone(input) as Record<string, unknown>;
  for (const key of Object.keys(copy)) {
    if (/secret|authorization|token|key/i.test(key)) copy[key] = '[redacted]';
  }
  return copy;
}

function referenceFromInput(input: Record<string, unknown>): string | null {
  return typeof input.reference === 'string' ? input.reference : null;
}

function referenceFromResponse(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of ['reference', 'transaction_reference', 'transactionReference']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  const nested = record.data;
  if (nested && typeof nested === 'object') return referenceFromResponse(nested);
  return null;
}

function referenceFromWebhook(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const direct = referenceFromResponse(payload);
  if (direct) return direct;
  const record = payload as Record<string, unknown>;
  if (record.data && typeof record.data === 'object') return referenceFromResponse(record.data);
  return null;
}

function toolNames(): KoraToolName[] {
  return [
    'kora_get_agent_capabilities',
    'kora_get_balance',
    'kora_list_banks',
    'kora_resolve_bank_account',
    'kora_create_payout',
    'kora_get_payout_status',
    'kora_list_payouts',
    'kora_create_checkout',
    'kora_create_virtual_account',
  ];
}

function toolDefinitions(publicBaseUrl: string) {
  const byName = new Map(
    buildCapabilities(publicBaseUrl).map((capability) => [capability.name, capability]),
  );
  return toolNames().map((name) => ({
    name,
    description: byName.get(name)?.description ?? name,
    inputSchema: inputSchemaForTool(name),
  }));
}

function inputSchemaForTool(tool: KoraToolName) {
  const agentId = { type: 'string', description: 'Kora Agent id. Defaults to demo-kora-agent.' };
  switch (tool) {
    case 'kora_get_agent_capabilities':
    case 'kora_get_balance':
      return { type: 'object', properties: { agent_id: agentId } };
    case 'kora_list_banks':
      return {
        type: 'object',
        properties: { agent_id: agentId, country_code: { type: 'string', default: 'NG' } },
      };
    case 'kora_resolve_bank_account':
      return {
        type: 'object',
        required: ['bank', 'account'],
        properties: {
          agent_id: agentId,
          bank: { type: 'string' },
          account: { type: 'string' },
          currency: { type: 'string', default: 'NGN' },
        },
      };
    case 'kora_create_payout':
      return {
        type: 'object',
        required: ['amount', 'currency', 'destination'],
        properties: {
          agent_id: agentId,
          reference: { type: 'string' },
          amount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
          currency: { type: 'string' },
          destination: { type: 'object' },
          narration: { type: 'string' },
          metadata: { type: 'object' },
        },
      };
    case 'kora_get_payout_status':
      return {
        type: 'object',
        required: ['transaction_reference'],
        properties: { agent_id: agentId, transaction_reference: { type: 'string' } },
      };
    case 'kora_list_payouts':
      return {
        type: 'object',
        properties: {
          agent_id: agentId,
          limit: { type: 'number', maximum: 100 },
          currency: { type: 'string' },
        },
      };
    case 'kora_create_checkout':
      return {
        type: 'object',
        required: ['amount', 'currency', 'customer'],
        properties: {
          agent_id: agentId,
          reference: { type: 'string' },
          amount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
          currency: { type: 'string' },
          customer: { type: 'object' },
          redirect_url: { type: 'string' },
          metadata: { type: 'object' },
        },
      };
    case 'kora_create_virtual_account':
      return {
        type: 'object',
        properties: {
          agent_id: agentId,
          account_name: { type: 'string' },
          customer: { type: 'object' },
          permanent: { type: 'boolean' },
          bank_code: { type: 'string' },
          currency: { type: 'string', default: 'NGN' },
          reference: { type: 'string' },
          metadata: { type: 'object' },
        },
      };
  }
}

function buildMcpManifest(publicBaseUrl: string) {
  return {
    name: 'Kora Agent Rail',
    slug: 'kora-agent-rail',
    description:
      'AI-consumable Kora local-currency services protected by Leash identity, policy, approvals, and receipts.',
    endpoint: `${publicBaseUrl}/mcp`,
    tools: toolDefinitions(publicBaseUrl),
    pricing: { type: 'variable', currency: 'LOCAL' },
    free_tier: 0,
  };
}

function buildOpenApi(publicBaseUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const tool of toolNames()) {
    paths[`/tools/${tool}`] = {
      post: {
        summary: tool,
        description: `Call ${tool} without exposing Kora API keys to the AI agent.`,
        requestBody: {
          required: false,
          content: { 'application/json': { schema: inputSchemaForTool(tool) } },
        },
        responses: {
          '200': { description: 'Tool call completed' },
          '202': { description: 'Human approval required' },
          '403': { description: 'Denied by Leash/policy gate' },
          '502': { description: 'Kora upstream call failed' },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Kora Agent Rail',
      version: '0.1.0',
      description:
        'Agent-facing rail for Kora local-currency services. Agents do not need Kora API keys.',
    },
    servers: [{ url: publicBaseUrl }],
    paths,
  };
}

function buildLlmsTxt(publicBaseUrl: string, agent: KoraAgent | null): string {
  const tools = toolDefinitions(publicBaseUrl)
    .map((tool) => `- ${tool.name}: POST ${publicBaseUrl}/tools/${tool.name}`)
    .join('\n');
  return `# Kora Agent Rail

Kora Agent Rail makes Kora local-currency services consumable by AI agents without exposing Kora API keys.

Default Kora Agent: ${agent?.id ?? 'unavailable'}

Protected tools require one of these caller identity headers:
- X-Leash-Agent
- X-Leash-Handle
- X-Leash-Domain

When KORA_REQUIRE_LEASH_SIGNATURE=true, protected tools also require:
- X-Leash-Timestamp
- X-Leash-Sig

Discovery:
- OpenAPI: ${publicBaseUrl}/openapi.json
- Leash MCP manifest: ${publicBaseUrl}/.well-known/leash-mcp.json
- MCP JSON-RPC endpoint: ${publicBaseUrl}/mcp

Tools:
${tools}
`;
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
