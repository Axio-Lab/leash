'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  BellIcon,
  CalendarClockIcon,
  Clock3Icon,
  DatabaseIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  WebhookIcon,
  WorkflowIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

type TriggerType = 'schedule' | 'webhook' | 'event';
type AutomationStatus = 'enabled' | 'paused';
type DeliveryPolicy = 'history_only' | 'every_run' | 'on_failure' | 'on_condition' | 'silent';

type Automation = {
  id: string;
  agent_mint: string;
  name: string;
  description: string | null;
  instructions: string;
  status: AutomationStatus;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  source_config: Record<string, unknown>;
  delivery_policy: DeliveryPolicy;
  delivery_config: Record<string, unknown>;
  budget_per_run: string;
  budget_per_day: string;
  timezone: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  failure_count: number;
  retention_days: number;
  created_at: string;
  updated_at: string;
};

type AutomationRun = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  output_text: string | null;
  error: string | null;
  spend_usd: string;
  delivery_status: string | null;
  created_at: string;
};

type AgentList = { items?: Array<{ mint?: string; name?: string }> };
type AutomationList = { items?: Automation[]; warning?: string };
type RunsList = { items?: AutomationRun[]; warning?: string };
type ToolkitConnections = {
  items?: Array<{
    id?: string;
    status?: string;
    toolkit_slug?: string;
    toolkit_name?: string;
  }>;
};

const EMPTY_AUTOMATIONS: Automation[] = [];
const EMPTY_RUNS: AutomationRun[] = [];
const EMPTY_TOOLKIT_CONNECTIONS: NonNullable<ToolkitConnections['items']> = [];

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

const capabilityCards = [
  {
    label: 'Schedules',
    value: 'Time based',
    detail: 'Daily, weekly, and interval runs with timezone-aware execution.',
    icon: CalendarClockIcon,
  },
  {
    label: 'Webhooks',
    value: 'Event ready',
    detail: 'Signed endpoints for external systems and internal event triggers.',
    icon: WebhookIcon,
  },
  {
    label: 'Sources',
    value: 'Data sources',
    detail: 'Use connected apps as the input layer for each automation.',
    icon: DatabaseIcon,
  },
  {
    label: 'Reports',
    value: 'Optional',
    detail: 'Save to history, deliver on every run, or notify only when it matters.',
    icon: BellIcon,
  },
] as const;

const deliveryLabels: Record<DeliveryPolicy, string> = {
  history_only: 'History only',
  every_run: 'Deliver every run',
  on_failure: 'Failure only',
  on_condition: 'Conditional',
  silent: 'No report',
};

const deliveryHelp: Record<DeliveryPolicy, string> = {
  history_only: 'Keep the report in run history only. Nothing is pushed to an external URL.',
  every_run: 'Send a report after every run, whether it succeeds or fails.',
  on_failure: 'Send a report only when the run fails or payment/cap checks block it.',
  on_condition:
    'Reserve for conditional reporting rules. Until conditions are expanded, it behaves like an important-run report path.',
  silent: 'Do not deliver a report. The run can still be audited from stored history.',
};

const eventHelp: Record<string, string> = {
  'treasury.low_balance':
    'Fires when Leash emits an internal low-balance signal for the agent treasury.',
  'receipt.settled': 'Fires after a Leash payment receipt is settled and recorded.',
  'connection.message':
    'Fires when a supported connected channel produces a message event for the agent.',
};

type Draft = {
  id: string | null;
  name: string;
  description: string;
  instructions: string;
  status: AutomationStatus;
  triggerType: TriggerType;
  scheduleKind: 'daily' | 'weekly' | 'interval';
  scheduleTime: string;
  scheduleWeekday: string;
  intervalMinutes: string;
  eventName: string;
  webhookLabel: string;
  webhookSecret: string;
  toolkitSlugs: string[];
  deliveryPolicy: DeliveryPolicy;
  reportWebhookUrl: string;
  reportSigningSecret: string;
  budgetPerRun: string;
  budgetPerDay: string;
  retentionDays: string;
};

function emptyDraft(): Draft {
  return {
    id: null,
    name: '',
    description: '',
    instructions: '',
    status: 'paused',
    triggerType: 'schedule',
    scheduleKind: 'daily',
    scheduleTime: '09:00',
    scheduleWeekday: '1',
    intervalMinutes: '60',
    eventName: 'treasury.low_balance',
    webhookLabel: 'Inbound webhook',
    webhookSecret: '',
    toolkitSlugs: [],
    deliveryPolicy: 'history_only',
    reportWebhookUrl: '',
    reportSigningSecret: '',
    budgetPerRun: '0.25',
    budgetPerDay: '2',
    retentionDays: '30',
  };
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.description === b.description &&
    a.instructions === b.instructions &&
    a.status === b.status &&
    a.triggerType === b.triggerType &&
    a.scheduleKind === b.scheduleKind &&
    a.scheduleTime === b.scheduleTime &&
    a.scheduleWeekday === b.scheduleWeekday &&
    a.intervalMinutes === b.intervalMinutes &&
    a.eventName === b.eventName &&
    a.webhookLabel === b.webhookLabel &&
    a.webhookSecret === b.webhookSecret &&
    stringArraysEqual(a.toolkitSlugs, b.toolkitSlugs) &&
    a.deliveryPolicy === b.deliveryPolicy &&
    a.reportWebhookUrl === b.reportWebhookUrl &&
    a.reportSigningSecret === b.reportSigningSecret &&
    a.budgetPerRun === b.budgetPerRun &&
    a.budgetPerDay === b.budgetPerDay &&
    a.retentionDays === b.retentionDays
  );
}

function draftFromAutomation(row: Automation): Draft {
  const toolkitSlugs = Array.isArray(row.source_config.toolkit_slugs)
    ? row.source_config.toolkit_slugs.map(String)
    : [];
  const scheduleKind =
    row.trigger_config.schedule === 'weekly' || row.trigger_config.schedule === 'interval'
      ? row.trigger_config.schedule
      : 'daily';
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    instructions: row.instructions ?? '',
    status: row.status,
    triggerType: row.trigger_type,
    scheduleKind,
    scheduleTime: typeof row.trigger_config.time === 'string' ? row.trigger_config.time : '09:00',
    scheduleWeekday:
      typeof row.trigger_config.weekday === 'number'
        ? String(row.trigger_config.weekday)
        : typeof row.trigger_config.weekday === 'string'
          ? row.trigger_config.weekday
          : '1',
    intervalMinutes:
      typeof row.trigger_config.interval_minutes === 'number'
        ? String(row.trigger_config.interval_minutes)
        : typeof row.trigger_config.interval_minutes === 'string'
          ? row.trigger_config.interval_minutes
          : '60',
    eventName:
      typeof row.trigger_config.event === 'string'
        ? row.trigger_config.event
        : 'treasury.low_balance',
    webhookLabel:
      typeof row.trigger_config.label === 'string' ? row.trigger_config.label : 'Inbound webhook',
    webhookSecret: typeof row.trigger_config.secret === 'string' ? row.trigger_config.secret : '',
    toolkitSlugs,
    deliveryPolicy: row.delivery_policy,
    reportWebhookUrl:
      typeof row.delivery_config.webhook_url === 'string' ? row.delivery_config.webhook_url : '',
    reportSigningSecret:
      typeof row.delivery_config.secret === 'string' ? row.delivery_config.secret : '',
    budgetPerRun: row.budget_per_run,
    budgetPerDay: row.budget_per_day,
    retentionDays: String(row.retention_days),
  };
}

function sourceCount(row: Automation): number {
  return Array.isArray(row.source_config.toolkit_slugs)
    ? row.source_config.toolkit_slugs.length
    : 0;
}

function triggerLabel(row: Pick<Automation, 'trigger_type' | 'trigger_config'>): string {
  if (row.trigger_type === 'schedule') {
    const kind =
      typeof row.trigger_config.schedule === 'string' ? row.trigger_config.schedule : 'daily';
    if (kind === 'interval') {
      const minutes =
        typeof row.trigger_config.interval_minutes === 'number'
          ? row.trigger_config.interval_minutes
          : Number.parseInt(String(row.trigger_config.interval_minutes ?? '60'), 10) || 60;
      return `every ${minutes} min`;
    }
    const time = typeof row.trigger_config.time === 'string' ? row.trigger_config.time : '09:00';
    return `${kind} at ${time}`;
  }
  if (row.trigger_type === 'webhook') return 'Signed webhook';
  const event = typeof row.trigger_config.event === 'string' ? row.trigger_config.event : 'Event';
  return event;
}

function formatShortDate(value: string | null): string {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

type AutomationDashboardProps = {
  mode?: 'index' | 'form';
  automationId?: string | null;
  onPromptMode?: () => void;
  showFormEyebrow?: boolean;
};

export function AutomationDashboard({
  mode = 'index',
  automationId = null,
  onPromptMode,
  showFormEyebrow = true,
}: AutomationDashboardProps = {}) {
  const router = useRouter();
  const isFormMode = mode === 'form';
  const [draft, setDraft] = React.useState<Draft>(() => emptyDraft());
  const [saving, setSaving] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const {
    data: automationsData,
    error: automationsError,
    isLoading: automationsLoading,
    mutate: mutateAutomations,
  } = useSWR('/api/automations', fetcher<AutomationList>);
  const { data: agentsData } = useSWR('/api/agents', fetcher<AgentList>, {
    revalidateOnFocus: false,
  });
  const { data: toolkitData } = useSWR('/api/composio/connections', fetcher<ToolkitConnections>, {
    revalidateOnFocus: false,
  });

  const automations = automationsData?.items ?? EMPTY_AUTOMATIONS;
  const primaryAgent = agentsData?.items?.find((a) => a.mint) ?? null;
  const selected = isFormMode
    ? (automations.find((a) => a.id === automationId) ?? null)
    : (automations.find((a) => a.id === selectedId) ?? automations[0] ?? null);
  const { data: runsData, isLoading: runsLoading } = useSWR(
    selected ? `/api/automations/${encodeURIComponent(selected.id)}/runs?limit=8` : null,
    fetcher<RunsList>,
  );
  const runs = runsData?.items ?? EMPTY_RUNS;
  const toolkitConnections = toolkitData?.items ?? EMPTY_TOOLKIT_CONNECTIONS;
  const activeToolkits = React.useMemo(
    () => toolkitConnections.filter((c) => c.status === 'ACTIVE' && c.toolkit_slug),
    [toolkitConnections],
  );

  React.useEffect(() => {
    if (isFormMode) return;
    if (!selectedId && automations[0]) setSelectedId(automations[0].id);
  }, [automations, isFormMode, selectedId]);

  React.useEffect(() => {
    if (!isFormMode || automationId) return;
    const nextDraft = emptyDraft();
    setDraft((prev) => (draftsEqual(prev, nextDraft) ? prev : nextDraft));
    setSelectedId((prev) => (prev === null ? prev : null));
  }, [automationId, isFormMode]);

  React.useEffect(() => {
    if (!isFormMode || !automationId) return;
    const row = automations.find((a) => a.id === automationId);
    if (!row) return;
    const nextDraft = draftFromAutomation(row);
    setDraft((prev) => (draftsEqual(prev, nextDraft) ? prev : nextDraft));
    setSelectedId((prev) => (prev === row.id ? prev : row.id));
  }, [automationId, automations, isFormMode]);

  function resetForm() {
    const nextDraft = emptyDraft();
    setDraft((prev) => (draftsEqual(prev, nextDraft) ? prev : nextDraft));
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => {
      if (prev[key] === value) return prev;
      return { ...prev, [key]: value };
    });
  }

  function toggleToolkit(slug: string, checked: boolean) {
    setDraft((prev) => {
      const set = new Set(prev.toolkitSlugs);
      if (checked) set.add(slug);
      else set.delete(slug);
      const toolkitSlugs = [...set].sort();
      if (stringArraysEqual(prev.toolkitSlugs, toolkitSlugs)) return prev;
      return { ...prev, toolkitSlugs };
    });
  }

  function buildTriggerConfig(): Record<string, unknown> {
    if (draft.triggerType === 'schedule') {
      if (draft.scheduleKind === 'interval') {
        return {
          schedule: 'interval',
          interval_minutes: Number.parseInt(draft.intervalMinutes, 10) || 60,
        };
      }
      return {
        schedule: draft.scheduleKind,
        time: draft.scheduleTime,
        ...(draft.scheduleKind === 'weekly'
          ? { weekday: Number.parseInt(draft.scheduleWeekday, 10) || 1 }
          : {}),
      };
    }
    if (draft.triggerType === 'webhook') {
      return { label: draft.webhookLabel.trim() || 'Inbound webhook', signature_required: true };
    }
    return { event: draft.eventName.trim() || 'treasury.low_balance' };
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!primaryAgent?.mint) {
      toast.error('Create an agent first', {
        description: 'Automations need a minted agent before they can be saved.',
      });
      return;
    }
    const name = draft.name.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    const instructions = draft.instructions.trim();
    if (!instructions) {
      toast.error('Instructions are required', {
        description: 'Tell the agent what the automation should do when it runs.',
      });
      return;
    }
    const perRun = Number.parseFloat(draft.budgetPerRun);
    const perDay = Number.parseFloat(draft.budgetPerDay);
    if (!Number.isFinite(perRun) || perRun < 0 || !Number.isFinite(perDay) || perDay < 0) {
      toast.error('Caps must be non-negative numbers');
      return;
    }

    setSaving(true);
    try {
      const body = {
        agent_mint: primaryAgent.mint,
        name,
        description: draft.description.trim() || null,
        instructions,
        status: draft.status,
        trigger_type: draft.triggerType,
        trigger_config: buildTriggerConfig(),
        source_config: { toolkit_slugs: draft.toolkitSlugs },
        delivery_policy: draft.deliveryPolicy,
        delivery_config:
          draft.deliveryPolicy === 'history_only' || draft.deliveryPolicy === 'silent'
            ? {}
            : {
                ...(draft.reportWebhookUrl.trim()
                  ? { webhook_url: draft.reportWebhookUrl.trim() }
                  : {}),
                ...(draft.reportSigningSecret.trim()
                  ? { secret: draft.reportSigningSecret.trim() }
                  : {}),
              },
        budget_per_run: draft.budgetPerRun,
        budget_per_day: draft.budgetPerDay,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        retention_days: Number.parseInt(draft.retentionDays, 10) || 30,
      };
      const url = draft.id
        ? `/api/automations/${encodeURIComponent(draft.id)}`
        : '/api/automations';
      const res = await fetch(url, {
        method: draft.id ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.slice(0, 240) || `HTTP ${res.status}`);
      const saved = JSON.parse(text) as Automation;
      setSelectedId(saved.id);
      setDraft(draftFromAutomation(saved));
      await mutateAutomations();
      toast.success(draft.id ? 'Automation updated' : 'Automation created');
      if (isFormMode && !draft.id) {
        router.replace(`/agents/automation/${encodeURIComponent(saved.id)}`);
      }
    } catch (err) {
      toast.error('Could not save automation', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function patchStatus(row: Automation, status: AutomationStatus) {
    try {
      const res = await fetch(`/api/automations/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mutateAutomations();
      toast.success(status === 'enabled' ? 'Automation enabled' : 'Automation paused');
    } catch (err) {
      toast.error('Could not update status', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  async function remove(row: Automation) {
    if (!window.confirm(`Delete "${row.name}"? Run history will remain in the audit log.`)) return;
    try {
      const res = await fetch(`/api/automations/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (selectedId === row.id) setSelectedId(null);
      if (draft.id === row.id) resetForm();
      await mutateAutomations();
      toast.success('Automation deleted');
    } catch (err) {
      toast.error('Could not delete automation', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  const runStates = [
    {
      label: 'Queued',
      value: runs.filter((r) => r.status === 'queued').length,
      tone: 'text-fg-muted',
    },
    {
      label: 'Running',
      value: runs.filter((r) => r.status === 'running').length,
      tone: 'text-brand',
    },
    {
      label: 'Failed',
      value: runs.filter((r) => r.status === 'failed').length,
      tone: 'text-warning',
    },
  ] as const;

  if (isFormMode) {
    const loadingExisting = Boolean(automationId) && automationsLoading && !selected;
    const missingExisting = Boolean(automationId) && !automationsLoading && !selected;
    const title = automationId ? 'Edit automation' : 'New automation';

    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-3 border-b border-border pb-4">
            <Link
              href="/agents/automation"
              className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              Automations
            </Link>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                {showFormEyebrow ? (
                  <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
                    <WorkflowIcon className="size-3.5" aria-hidden="true" />
                    Automation
                  </div>
                ) : null}
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">
                  Configure when the agent runs, which data sources it can use, and how the result
                  is stored or reported.
                </p>
              </div>
              {onPromptMode ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-10 w-fit shrink-0 border-brand/60 hover:border-brand"
                  onClick={onPromptMode}
                >
                  <SparklesIcon className="size-4" aria-hidden="true" />
                  Prompt automation
                </Button>
              ) : null}
            </div>
          </header>

          {automationsData?.warning ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
              {automationsData.warning}
            </div>
          ) : null}

          {loadingExisting ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elev/70 px-4 py-8 text-sm text-fg-muted">
              <Spinner size="sm" /> Loading automation
            </div>
          ) : missingExisting ? (
            <div className="rounded-lg border border-border bg-bg-elev/70 px-4 py-8 text-sm text-fg-muted">
              Automation not found.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <AutomationEditor
                draft={draft}
                activeToolkits={activeToolkits}
                saving={saving}
                hasAgent={Boolean(primaryAgent?.mint)}
                onSave={save}
                onDraft={updateDraft}
                onToggleToolkit={toggleToolkit}
              />
              <AutomationHelpPanel />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
              <WorkflowIcon className="size-3.5" aria-hidden="true" />
              Automation
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Agent automations</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">
              Run scheduled, webhook, and event-triggered work with connected data sources and
              optional report delivery.
            </p>
          </div>
          <Button asChild className="min-h-10">
            <Link href="/agents/automation/new">
              <PlusIcon className="size-4" aria-hidden="true" />
              New automation
            </Link>
          </Button>
        </header>

        {automationsData?.warning ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            {automationsData.warning}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rounded-lg border border-border bg-bg-elev/70">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-medium">Automations</h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {automations.length} saved ·{' '}
                  {automations.filter((a) => a.status === 'enabled').length} enabled
                </p>
              </div>
              <Link
                href="/settings/connections"
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev"
              >
                Manage data sources
              </Link>
            </div>

            {automationsLoading ? (
              <div className="flex items-center gap-2 px-4 py-8 text-sm text-fg-muted">
                <Spinner size="sm" /> Loading automations
              </div>
            ) : automationsError ? (
              <div className="px-4 py-8 text-sm text-danger">
                Could not load automations: {(automationsError as Error).message}
              </div>
            ) : automations.length === 0 ? (
              <EmptyAutomationState />
            ) : (
              <ul className="divide-y divide-border">
                {automations.map((row) => {
                  const active = selected?.id === row.id;
                  return (
                    <li key={row.id} className={active ? 'bg-brand/8' : undefined}>
                      <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(row.id);
                          }}
                          className="min-w-0 flex-1 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-fg">{row.name}</span>
                            <StatusBadge status={row.status} />
                            <TriggerBadge trigger={row.trigger_type} />
                          </div>
                          <div className="mt-1 line-clamp-1 text-xs text-fg-muted">
                            {row.description || triggerLabel(row)}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                            <span>
                              {sourceCount(row)} source{sourceCount(row) === 1 ? '' : 's'}
                            </span>
                            <span>{deliveryLabels[row.delivery_policy]}</span>
                            <span>
                              ${row.budget_per_run}/run · ${row.budget_per_day}/day
                            </span>
                            <span>Last {formatShortDate(row.last_run_at)}</span>
                          </div>
                        </button>
                        <div className="flex items-center gap-2 lg:justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              patchStatus(row, row.status === 'enabled' ? 'paused' : 'enabled')
                            }
                          >
                            {row.status === 'enabled' ? (
                              <PauseIcon className="size-3.5" aria-hidden="true" />
                            ) : (
                              <PlayIcon className="size-3.5" aria-hidden="true" />
                            )}
                            {row.status === 'enabled' ? 'Pause' : 'Enable'}
                          </Button>
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/agents/automation/${encodeURIComponent(row.id)}`}>
                              <MoreHorizontalIcon className="size-3.5" aria-hidden="true" />
                              Edit
                            </Link>
                          </Button>
                          <button
                            type="button"
                            onClick={() => remove(row)}
                            className="grid min-h-10 min-w-10 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev"
                            aria-label={`Delete ${row.name}`}
                          >
                            <Trash2Icon className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <RunHistoryPanel
            selected={selected}
            runs={runs}
            isLoading={runsLoading}
            runStates={runStates}
          />
        </section>
      </div>
    </div>
  );
}

function EmptyAutomationState() {
  return (
    <div className="grid min-h-[280px] place-items-center px-4 py-10 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-lg border border-border bg-bg">
          <Clock3Icon className="size-5 text-brand" aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-base font-medium">Build the first background run</h3>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Start with a schedule, webhook, or event trigger, then choose which data sources the agent
          can read and where reports should go.
        </p>
        <Button asChild className="mt-5 min-h-10">
          <Link href="/agents/automation/new">
            <PlusIcon className="size-4" aria-hidden="true" />
            New automation
          </Link>
        </Button>
      </div>
    </div>
  );
}

function AutomationHelpPanel() {
  return (
    <aside className="space-y-3">
      <div className="rounded-lg border border-border bg-bg-elev/70 p-4">
        <h2 className="text-sm font-medium">How automations run</h2>
        <div className="mt-4 space-y-3">
          {capabilityCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-bg">
                  <Icon className="size-4 text-brand" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-fg">{card.label}</div>
                  <p className="mt-0.5 text-xs leading-5 text-fg-muted">{card.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-bg p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheckIcon className="size-4 text-success" aria-hidden="true" />
          Safety defaults
        </div>
        <ul className="mt-3 space-y-2 text-xs leading-5 text-fg-muted">
          <li>Payment requests are checked against run and day caps before settlement.</li>
          <li>
            Withdrawals, delegation changes, cap changes, and settlement signing require approval.
          </li>
        </ul>
      </div>
    </aside>
  );
}

function AutomationEditor({
  draft,
  activeToolkits,
  saving,
  hasAgent,
  onSave,
  onDraft,
  onToggleToolkit,
}: {
  draft: Draft;
  activeToolkits: NonNullable<ToolkitConnections['items']>;
  saving: boolean;
  hasAgent: boolean;
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
  onDraft: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  onToggleToolkit: (slug: string, checked: boolean) => void;
}) {
  return (
    <form
      onSubmit={onSave}
      aria-busy={saving ? 'true' : undefined}
      className="rounded-lg border border-border bg-bg-elev/70 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{draft.id ? 'Edit automation' : 'New automation'}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Configure triggers, sources, reports, and caps.
          </p>
        </div>
        <Button type="submit" size="sm" disabled={saving || !hasAgent}>
          {saving ? <Spinner size="sm" /> : <SaveIcon className="size-3.5" aria-hidden="true" />}
          Save
        </Button>
      </div>

      {!hasAgent ? (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
          Mint an agent before saving automations.
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        <Field label="Name">
          <input
            value={draft.name}
            onChange={(e) => onDraft('name', e.target.value)}
            placeholder="Morning operator brief"
            autoComplete="off"
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/70"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={draft.description}
            onChange={(e) => onDraft('description', e.target.value)}
            rows={3}
            placeholder="Summarize priority inboxes and flag anything that needs action."
            className="w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/70"
          />
        </Field>
        <Field
          label="Run instructions"
          hint="The exact job the agent should complete each time this automation runs."
        >
          <textarea
            value={draft.instructions}
            onChange={(e) => onDraft('instructions', e.target.value)}
            rows={5}
            placeholder="Check connected inboxes, summarize urgent items, and include recommended next actions."
            className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/70"
          />
        </Field>

        <Field
          label="Trigger"
          hint="Schedule runs on time, webhook runs from an external POST, and event listens to internal Leash signals."
        >
          <div className="grid grid-cols-3 gap-1.5">
            {(['schedule', 'webhook', 'event'] as const).map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => onDraft('triggerType', type)}
                className={`min-h-10 rounded-md border px-2 text-xs capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  draft.triggerType === type
                    ? 'border-brand/50 bg-brand/15 text-fg'
                    : 'border-border bg-bg text-fg-muted hover:border-border-strong hover:text-fg'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </Field>

        {draft.triggerType === 'schedule' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cadence">
              <select
                value={draft.scheduleKind}
                onChange={(e) => onDraft('scheduleKind', e.target.value as Draft['scheduleKind'])}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="interval">Interval</option>
              </select>
            </Field>
            {draft.scheduleKind === 'interval' ? (
              <Field label="Every minutes">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={draft.intervalMinutes}
                  onChange={(e) => onDraft('intervalMinutes', e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
                />
              </Field>
            ) : (
              <Field label="Time">
                <input
                  type="time"
                  value={draft.scheduleTime}
                  onChange={(e) => onDraft('scheduleTime', e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
                />
              </Field>
            )}
            {draft.scheduleKind === 'weekly' ? (
              <Field label="Weekday">
                <select
                  value={draft.scheduleWeekday}
                  onChange={(e) => onDraft('scheduleWeekday', e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
                >
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                  <option value="0">Sunday</option>
                </select>
              </Field>
            ) : null}
          </div>
        ) : draft.triggerType === 'webhook' ? (
          <div className="space-y-2">
            <Field label="Webhook label">
              <input
                value={draft.webhookLabel}
                onChange={(e) => onDraft('webhookLabel', e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
              />
            </Field>
            <Field
              label="Endpoint path"
              hint="Send a signed POST to this apps/api path after saving."
            >
              <input
                readOnly
                value={draft.id ? `/v1/automation-hooks/${draft.id}` : 'Saved after create'}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg-muted focus:outline-none focus:ring-2 focus:ring-brand/70"
              />
            </Field>
            {draft.webhookSecret ? (
              <Field label="Signing secret">
                <input
                  readOnly
                  value={draft.webhookSecret}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg-muted focus:outline-none focus:ring-2 focus:ring-brand/70"
                />
              </Field>
            ) : null}
          </div>
        ) : (
          <Field
            label="Event"
            hint={eventHelp[draft.eventName] ?? 'Runs when the selected internal event is fired.'}
          >
            <select
              value={draft.eventName}
              onChange={(e) => onDraft('eventName', e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
            >
              <option value="treasury.low_balance">Treasury low balance</option>
              <option value="receipt.settled">Receipt settled</option>
              <option value="connection.message">Data source message</option>
            </select>
          </Field>
        )}

        <Field
          label="Data sources"
          hint="Only selected connected data sources are exposed to this automation run."
        >
          {activeToolkits.length === 0 ? (
            <div className="rounded-md border border-border bg-bg px-3 py-3 text-xs leading-5 text-fg-muted">
              No connected data sources yet.{' '}
              <Link href="/settings/connections" className="text-brand hover:underline">
                Add data sources
              </Link>
            </div>
          ) : (
            <div className="space-y-1.5">
              {activeToolkits.map((conn) => {
                const slug = conn.toolkit_slug!;
                return (
                  <label
                    key={conn.id ?? slug}
                    className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-sm hover:border-border-strong"
                  >
                    <input
                      type="checkbox"
                      checked={draft.toolkitSlugs.includes(slug)}
                      onChange={(e) => onToggleToolkit(slug, e.target.checked)}
                      className="size-4 accent-brand"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {conn.toolkit_name || slug}
                      <span className="ml-2 font-mono text-[10px] text-fg-subtle">{slug}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </Field>

        <Field label="Report policy" hint={deliveryHelp[draft.deliveryPolicy]}>
          <select
            value={draft.deliveryPolicy}
            onChange={(e) => onDraft('deliveryPolicy', e.target.value as DeliveryPolicy)}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
          >
            {Object.entries(deliveryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        {draft.deliveryPolicy !== 'history_only' && draft.deliveryPolicy !== 'silent' ? (
          <div className="grid gap-2">
            <Field
              label="Report webhook URL"
              hint="Where Leash should POST the run report when this policy delivers one."
            >
              <input
                type="url"
                inputMode="url"
                value={draft.reportWebhookUrl}
                onChange={(e) => onDraft('reportWebhookUrl', e.target.value)}
                placeholder="https://example.com/leash-report"
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/70"
              />
            </Field>
            <Field
              label="Report signing secret"
              hint="Optional HMAC secret used to sign report delivery payloads."
            >
              <input
                value={draft.reportSigningSecret}
                onChange={(e) => onDraft('reportSigningSecret', e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
              />
            </Field>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Cap per run"
            hint="Maximum payment-request value for one run. 0.25 means $0.25 USDC-equivalent."
          >
            <input
              type="text"
              inputMode="decimal"
              value={draft.budgetPerRun}
              onChange={(e) => onDraft('budgetPerRun', e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
            />
          </Field>
          <Field
            label="Cap per day"
            hint="Maximum payment-request value across all runs in one UTC day. 2 means $2 USDC-equivalent."
          >
            <input
              type="text"
              inputMode="decimal"
              value={draft.budgetPerDay}
              onChange={(e) => onDraft('budgetPerDay', e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
            />
          </Field>
        </div>

        <Field
          label="Run retention"
          hint="How many days to keep run history before old runs are pruned. 30 means one month of history."
        >
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draft.retentionDays}
            onChange={(e) => onDraft('retentionDays', e.target.value)}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
          />
        </Field>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="block text-xs leading-5 text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

function StatusBadge({ status }: { status: AutomationStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
        status === 'enabled' ? 'bg-success/12 text-success' : 'bg-bg text-fg-subtle'
      }`}
    >
      {status === 'enabled' ? 'Enabled' : 'Paused'}
    </span>
  );
}

function TriggerBadge({ trigger }: { trigger: TriggerType }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-bg px-2 py-0.5 text-[10px] font-medium capitalize text-fg-muted">
      {trigger}
    </span>
  );
}

function RunHistoryPanel({
  selected,
  runs,
  isLoading,
  runStates,
}: {
  selected: Automation | null;
  runs: AutomationRun[];
  isLoading: boolean;
  runStates: readonly { label: string; value: number; tone: string }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-elev/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Run history</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {selected ? selected.name : 'Select an automation to inspect runs'}
          </p>
        </div>
        <HistoryIcon className="size-4 text-fg-subtle" aria-hidden="true" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {runStates.map((state) => (
          <div key={state.label} className="rounded-md border border-border bg-bg px-3 py-2">
            <div className={`text-lg font-semibold ${state.tone}`}>{state.value}</div>
            <div className="mt-0.5 text-[11px] leading-4 text-fg-subtle">{state.label}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size="sm" /> Loading runs
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-4 rounded-md border border-border bg-bg px-3 py-3 text-xs leading-5 text-fg-muted">
          No runs recorded yet. Enabled scheduled automations will appear here after the worker
          claims and finishes them.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-md border border-border bg-bg">
          {runs.map((run) => (
            <li key={run.id} className="px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium capitalize text-fg">{run.status}</span>
                <span className="text-fg-subtle">{formatShortDate(run.created_at)}</span>
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-fg-muted">
                {run.error || run.output_text || 'No output text recorded.'}
              </div>
              <div className="mt-1 text-[11px] text-fg-subtle">
                ${run.spend_usd} spent · delivery {run.delivery_status ?? 'not attempted'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
