import Link from 'next/link';
import {
  AlertTriangleIcon,
  BellIcon,
  CalendarClockIcon,
  Clock3Icon,
  DatabaseIcon,
  HistoryIcon,
  PlusIcon,
  ShieldCheckIcon,
  WebhookIcon,
  WorkflowIcon,
} from 'lucide-react';

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

const runStates = [
  { label: 'Queued', value: '0', tone: 'text-fg-muted' },
  { label: 'Running', value: '0', tone: 'text-brand' },
  { label: 'Needs attention', value: '0', tone: 'text-warning' },
] as const;

export default function AutomationPage() {
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
              Create scheduled, webhook, and event-triggered runs that use your connected tools,
              write history, and deliver reports only when the automation calls for it.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            New automation
          </button>
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

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-border bg-bg-elev/70">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-medium">Automations</h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  No automations have been created for this agent workspace.
                </p>
              </div>
              <Link
                href="/settings/connections"
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev"
              >
                Manage connections
              </Link>
            </div>

            <div className="grid min-h-[280px] place-items-center px-4 py-10 text-center">
              <div className="max-w-md">
                <span className="mx-auto grid size-12 place-items-center rounded-lg border border-border bg-bg">
                  <Clock3Icon className="size-5 text-brand" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-medium">Build the first background run</h3>
                <p className="mt-2 text-sm leading-6 text-fg-muted">
                  Start with a schedule, webhook, or event trigger, then choose which connections
                  the agent can read and where reports should go.
                </p>
                <button
                  type="button"
                  className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev"
                >
                  <PlusIcon className="size-4" aria-hidden="true" />
                  New automation
                </button>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-border bg-bg-elev/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">Run monitor</h2>
                <HistoryIcon className="size-4 text-fg-subtle" aria-hidden="true" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {runStates.map((state) => (
                  <div
                    key={state.label}
                    className="rounded-md border border-border bg-bg px-3 py-2"
                  >
                    <div className={`text-lg font-semibold ${state.tone}`}>{state.value}</div>
                    <div className="mt-0.5 text-[11px] leading-4 text-fg-subtle">{state.label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-md border border-border bg-bg px-3 py-2.5 text-xs leading-5 text-fg-muted">
                Every run will keep history, spend decisions, receipts, delivery attempts, and
                failure reasons.
              </div>
            </div>

            <div className="rounded-lg border border-border bg-bg-elev/70 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheckIcon className="size-4 text-success" aria-hidden="true" />
                Safety defaults
              </div>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-fg-muted">
                <li className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-success" />
                  Tool and API payments can run automatically only under per-run and daily caps.
                </li>
                <li className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
                  Withdrawals, delegation changes, and cap changes require explicit approval.
                </li>
              </ul>
            </div>

            <div className="rounded-lg border border-warning/35 bg-warning/8 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-warning">
                <AlertTriangleIcon className="size-4" aria-hidden="true" />
                Setup checks
              </div>
              <p className="mt-2 text-xs leading-5 text-fg-muted">
                Automations need at least one minted agent. Connected data sources and delivery
                targets can be added now or attached later per automation.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
