'use client';

import Link from 'next/link';
import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  AlertTriangleIcon,
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
    value: 'Connections',
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
  toolkitSlugs: string[];
  deliveryPolicy: DeliveryPolicy;
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
    toolkitSlugs: [],
    deliveryPolicy: 'history_only',
    budgetPerRun: '0.25',
    budgetPerDay: '2',
    retentionDays: '30',
  };
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
    toolkitSlugs,
    deliveryPolicy: row.delivery_policy,
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

export function AutomationDashboard() {
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

  const automations = automationsData?.items ?? [];
  const primaryAgent = agentsData?.items?.find((a) => a.mint) ?? null;
  const selected = automations.find((a) => a.id === selectedId) ?? automations[0] ?? null;
  const { data: runsData, isLoading: runsLoading } = useSWR(
    selected ? `/api/automations/${encodeURIComponent(selected.id)}/runs?limit=8` : null,
    fetcher<RunsList>,
  );
  const runs = runsData?.items ?? [];
  const activeToolkits = (toolkitData?.items ?? []).filter(
    (c) => c.status === 'ACTIVE' && c.toolkit_slug,
  );

  React.useEffect(() => {
    if (!selectedId && automations[0]) setSelectedId(automations[0].id);
  }, [automations, selectedId]);

  function resetForm() {
    setDraft(emptyDraft());
  }

  function edit(row: Automation) {
    setDraft(draftFromAutomation(row));
    setSelectedId(row.id);
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function toggleToolkit(slug: string, checked: boolean) {
    setDraft((prev) => {
      const set = new Set(prev.toolkitSlugs);
      if (checked) set.add(slug);
      else set.delete(slug);
      return { ...prev, toolkitSlugs: [...set].sort() };
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
        delivery_config: {},
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
              Run scheduled, webhook, and event-triggered work with connected tools as sources and
              optional report delivery.
            </p>
          </div>
          <Button type="button" onClick={resetForm} className="min-h-10">
            <PlusIcon className="size-4" aria-hidden="true" />
            New automation
          </Button>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Automation scope">
          {capabilityCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="rounded-lg border border-border bg-bg-elev/70 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-bg">
                    <Icon className="size-4 text-brand" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-mono uppercase tracking-widest text-fg-subtle">
                      {card.label}
                    </div>
                    <div className="mt-1 text-sm font-medium text-fg">{card.value}</div>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-fg-muted">{card.detail}</p>
              </div>
            );
          })}
        </section>

        {automationsData?.warning ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            {automationsData.warning}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
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
                  Manage connections
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
                <EmptyAutomationState onCreate={resetForm} />
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
                              edit(row);
                            }}
                            className="min-w-0 flex-1 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium text-fg">
                                {row.name}
                              </span>
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
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => edit(row)}
                            >
                              <MoreHorizontalIcon className="size-3.5" aria-hidden="true" />
                              Edit
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
          </div>

          <AutomationEditor
            draft={draft}
            activeToolkits={activeToolkits}
            saving={saving}
            hasAgent={Boolean(primaryAgent?.mint)}
            onSave={save}
            onDraft={updateDraft}
            onToggleToolkit={toggleToolkit}
          />
        </section>
      </div>
    </div>
  );
}

function EmptyAutomationState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid min-h-[280px] place-items-center px-4 py-10 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-lg border border-border bg-bg">
          <Clock3Icon className="size-5 text-brand" aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-base font-medium">Build the first background run</h3>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Start with a schedule, webhook, or event trigger, then choose which connections the agent
          can read and where reports should go.
        </p>
        <Button type="button" onClick={onCreate} className="mt-5 min-h-10">
          <PlusIcon className="size-4" aria-hidden="true" />
          New automation
        </Button>
      </div>
    </div>
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
        <Field label="Run instructions">
          <textarea
            value={draft.instructions}
            onChange={(e) => onDraft('instructions', e.target.value)}
            rows={5}
            placeholder="Check connected inboxes, summarize urgent items, and include recommended next actions."
            className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/70"
          />
        </Field>

        <Field label="Trigger">
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
          <Field label="Webhook label">
            <input
              value={draft.webhookLabel}
              onChange={(e) => onDraft('webhookLabel', e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
            />
          </Field>
        ) : (
          <Field label="Event">
            <select
              value={draft.eventName}
              onChange={(e) => onDraft('eventName', e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
            >
              <option value="treasury.low_balance">Treasury low balance</option>
              <option value="receipt.settled">Receipt settled</option>
              <option value="connection.message">Connection message</option>
            </select>
          </Field>
        )}

        <Field label="Data sources">
          {activeToolkits.length === 0 ? (
            <div className="rounded-md border border-border bg-bg px-3 py-3 text-xs leading-5 text-fg-muted">
              No connected toolkits yet.{' '}
              <Link href="/settings/connections" className="text-brand hover:underline">
                Add connections
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

        <Field label="Report policy">
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

        <div className="grid grid-cols-2 gap-2">
          <Field label="Cap per run">
            <input
              type="text"
              inputMode="decimal"
              value={draft.budgetPerRun}
              onChange={(e) => onDraft('budgetPerRun', e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
            />
          </Field>
          <Field label="Cap per day">
            <input
              type="text"
              inputMode="decimal"
              value={draft.budgetPerDay}
              onChange={(e) => onDraft('budgetPerDay', e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/70"
            />
          </Field>
        </div>

        <Field label="Run retention">
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

      <div className="mt-5 space-y-3">
        <div className="rounded-lg border border-border bg-bg p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheckIcon className="size-4 text-success" aria-hidden="true" />
            Safety defaults
          </div>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-fg-muted">
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-success" />
              Tool and API payments can run automatically only under configured caps.
            </li>
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
              Withdrawals, delegation changes, and cap changes require approval.
            </li>
          </ul>
        </div>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
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

      <div className="mt-4 rounded-md border border-warning/35 bg-warning/8 px-3 py-2.5 text-xs leading-5 text-fg-muted">
        <div className="flex items-center gap-2 font-medium text-warning">
          <AlertTriangleIcon className="size-3.5" aria-hidden="true" />
          Missing pieces tracked
        </div>
        <p className="mt-1">
          Scheduler claims, webhook signatures, event dedupe, delivery attempts, spend receipts,
          retention pruning, and kill-switch behavior are planned as separate tested commits.
        </p>
      </div>
    </div>
  );
}
