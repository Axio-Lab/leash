import type {
  AutomationDeliveryPolicy,
  AutomationRow,
  AutomationRunStatus,
} from '../storage/automations.js';
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
};

export type ReportDeliveryResult = {
  status: string;
  result: Record<string, unknown>;
};

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

export async function deliverAutomationReport(
  input: ReportDeliveryInput,
  options: ReportDeliveryOptions = {},
): Promise<ReportDeliveryResult> {
  const policy = input.automation.deliveryPolicy;
  if (policy === 'silent') return { status: 'suppressed', result: { policy } };
  if (!policyApplies(policy, input.status)) return { status: 'history_only', result: { policy } };

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
