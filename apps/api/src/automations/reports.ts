import type {
  AutomationDeliveryPolicy,
  AutomationRow,
  AutomationRunStatus,
} from '../storage/automations.js';
import { getExternalConnection, recordExternalMessage } from '../storage/external-connections.js';
import type { LeashApiConfig } from '../config.js';
import type { DbClient } from '../storage/turso.js';
import { decryptSecret } from '@leashmarket/platform-auth/encryption';
import { createTelegramClient, type TelegramClient } from '../external/telegram-client.js';
import type { WhatsAppManager } from '../external/whatsapp-manager.js';
import { signPayload } from '../webhooks/sign.js';

export type ReportDeliveryInput = {
  automation: AutomationRow;
  runId: string;
  status: Extract<AutomationRunStatus, 'succeeded' | 'failed' | 'skipped' | 'cancelled'>;
  outputText?: string | null;
  error?: string | null;
  triggerPayload?: Record<string, unknown>;
  artifacts?: unknown[];
};

export type ReportDeliveryOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  externalChat?: ExternalChatDeliveryDeps;
};

export type ReportDeliveryResult = {
  status: string;
  result: Record<string, unknown>;
};

export type ExternalChatDeliveryDeps = {
  config: LeashApiConfig;
  db: DbClient;
  whatsapp?: Pick<WhatsAppManager, 'sendOutboundText'>;
  telegramClientFactory?: (botToken: string) => TelegramClient;
};

let configuredExternalChatDelivery: ExternalChatDeliveryDeps | null = null;

export function setAutomationExternalChatDeliveryDeps(deps: ExternalChatDeliveryDeps | null): void {
  configuredExternalChatDelivery = deps;
}

function policyApplies(policy: AutomationDeliveryPolicy, status: ReportDeliveryInput['status']) {
  switch (policy) {
    case 'silent':
      return false;
    case 'history_only':
      return false;
    case 'on_failure':
      return status === 'failed';
    case 'on_condition':
      return status === 'failed' || status === 'succeeded';
    case 'every_run':
      return true;
    default:
      return false;
  }
}

function deliveryUrl(config: Record<string, unknown>): string | null {
  const url = config.webhook_url;
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

function externalChatConfig(config: Record<string, unknown>): {
  connectionId: string;
  channel: 'telegram' | 'whatsapp';
} | null {
  if (config.kind !== 'external_chat') return null;
  const connectionId = config.connection_id;
  const channel = config.channel;
  if (typeof connectionId !== 'string') return null;
  if (channel !== 'telegram' && channel !== 'whatsapp') return null;
  return { connectionId, channel };
}

function formatExternalChatReport(input: ReportDeliveryInput): string {
  return [
    `Automation report: ${input.automation.name}`,
    `Status: ${input.status}`,
    input.outputText ? `\n${input.outputText}` : null,
    input.error ? `\nError: ${input.error}` : null,
    `\nRun: ${input.runId}`,
  ]
    .filter((line): line is string => line != null && line.length > 0)
    .join('\n');
}

async function deliverExternalChatReport(
  input: ReportDeliveryInput,
  config: { connectionId: string; channel: 'telegram' | 'whatsapp' },
  deps: ExternalChatDeliveryDeps | null,
): Promise<ReportDeliveryResult> {
  const base = {
    policy: input.automation.deliveryPolicy,
    kind: 'external_chat',
    connection_id: config.connectionId,
    channel: config.channel,
  };
  if (!deps) {
    return {
      status: 'failed',
      result: { ...base, error: 'external_chat_delivery_not_configured' },
    };
  }
  const conn = await getExternalConnection(deps.db, config.connectionId);
  if (!conn || conn.status !== 'connected' || conn.channel !== config.channel) {
    return { status: 'failed', result: { ...base, error: 'external_connection_unavailable' } };
  }
  const text = formatExternalChatReport(input);
  try {
    if (conn.channel === 'whatsapp') {
      const ok = deps.whatsapp ? await deps.whatsapp.sendOutboundText(conn.id, text) : false;
      if (!ok) return { status: 'failed', result: { ...base, error: 'whatsapp_unavailable' } };
    } else {
      if (!conn.encryptedCredential || !deps.config.encryptionKey || !conn.boundChatId) {
        return { status: 'failed', result: { ...base, error: 'telegram_unavailable' } };
      }
      const botToken = decryptSecret(conn.encryptedCredential, deps.config.encryptionKey);
      const telegram = deps.telegramClientFactory?.(botToken) ?? createTelegramClient({ botToken });
      const sent = await telegram.sendMessage({
        chatId: conn.boundChatId,
        text,
        disableWebPagePreview: false,
      });
      if (!sent.ok) {
        return {
          status: 'failed',
          result: { ...base, error: 'telegram_send_failed', response_status: sent.status },
        };
      }
    }
    await recordExternalMessage(deps.db, {
      connectionId: conn.id,
      direction: 'outbound',
      payload: {
        kind: 'automation_report',
        automation_id: input.automation.id,
        run_id: input.runId,
        status: input.status,
        len: text.length,
      },
    });
    return { status: 'delivered', result: { ...base } };
  } catch (err) {
    return {
      status: 'failed',
      result: { ...base, error: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function deliverAutomationReport(
  input: ReportDeliveryInput,
  options: ReportDeliveryOptions = {},
): Promise<ReportDeliveryResult> {
  const policy = input.automation.deliveryPolicy;
  if (policy === 'silent') return { status: 'suppressed', result: { policy } };
  if (!policyApplies(policy, input.status)) return { status: 'history_only', result: { policy } };

  const externalChat = externalChatConfig(input.automation.deliveryConfig);
  if (externalChat) {
    return deliverExternalChatReport(
      input,
      externalChat,
      options.externalChat ?? configuredExternalChatDelivery,
    );
  }

  const url = deliveryUrl(input.automation.deliveryConfig);
  if (!url) return { status: 'no_destination', result: { policy } };

  const body = JSON.stringify({
    type: 'automation.report',
    automation_id: input.automation.id,
    automation_name: input.automation.name,
    run_id: input.runId,
    status: input.status,
    output_text: input.outputText ?? null,
    error: input.error ?? null,
    trigger_type: input.automation.triggerType,
    trigger_payload: input.triggerPayload ?? {},
    artifacts: input.artifacts ?? [],
    created_at: new Date().toISOString(),
  });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-leash-automation': input.automation.id,
    'x-leash-automation-run': input.runId,
  };
  const secret = input.automation.deliveryConfig.secret;
  if (typeof secret === 'string' && secret.length > 0) {
    headers['x-leash-signature'] = signPayload(secret, body).header;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), options.timeoutMs ?? 8_000);
  try {
    const res = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers,
      body,
      signal: ac.signal,
    });
    if (res.status >= 200 && res.status < 300) {
      return { status: 'delivered', result: { policy, url, response_status: res.status } };
    }
    return { status: 'failed', result: { policy, url, response_status: res.status } };
  } catch (err) {
    return {
      status: 'failed',
      result: {
        policy,
        url,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
