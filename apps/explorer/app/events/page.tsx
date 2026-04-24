import { apiFetch, type EventPage } from '@/lib/api';
import { getNetwork } from '@/lib/server-network';
import { networkToSlug } from '@/lib/network';
import { EventsTable } from '@/components/events-table';
import { ApiUnreachable } from '@/components/empty';

export const dynamic = 'force-dynamic';

const KIND_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'agent.identity.register', label: 'Identity' },
  { value: 'agent.executive.register', label: 'Executive' },
  { value: 'agent.executive.delegate', label: 'Delegate' },
  { value: 'agent.delegation.set', label: 'Allowance' },
  { value: 'agent.delegation.revoke', label: 'Revoke' },
  { value: 'agent.treasury.provision', label: 'Provision' },
  { value: 'agent.treasury.withdraw', label: 'Withdraw' },
  { value: 'agent.treasury.withdraw_sol', label: 'Withdraw SOL' },
  { value: 'agent.token.set', label: 'Token' },
  { value: 'submit.raw', label: 'Submit' },
  { value: 'receipt.published', label: 'Receipt' },
  { value: 'receipt.pulled', label: 'Pulled' },
];

type Props = {
  searchParams: Promise<{ kind?: string; cursor?: string }>;
};

export default async function EventsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const network = await getNetwork();
  const params = new URLSearchParams();
  if (sp.kind) params.set('kind', sp.kind);
  if (sp.cursor) params.set('cursor', sp.cursor);
  params.set('limit', '50');

  const res = await apiFetch<EventPage>(network, `/v1/events?${params.toString()}`);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-fg-subtle]">
          {networkToSlug(network)} · events
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Event feed</h1>
      </header>

      <nav className="flex flex-wrap gap-2">
        {KIND_OPTIONS.map((opt) => {
          const href = opt.value ? `/events?kind=${opt.value}` : '/events';
          const active = (sp.kind ?? '') === opt.value;
          return (
            <a
              key={opt.value || 'all'}
              href={href}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? 'border-[--color-brand-strong] bg-[--color-brand-soft] text-[--color-fg]'
                  : 'border-[--color-border] bg-[--color-bg-elev] text-[--color-fg-muted] hover:text-[--color-fg]'
              }`}
            >
              {opt.label}
            </a>
          );
        })}
      </nav>

      {res.ok ? (
        <>
          <EventsTable rows={res.data.items} network={network} />
          {res.data.next_cursor ? (
            <div className="flex justify-end">
              <a
                href={`/events?${new URLSearchParams({
                  ...(sp.kind ? { kind: sp.kind } : {}),
                  cursor: res.data.next_cursor,
                }).toString()}`}
                className="rounded-md border border-[--color-border] bg-[--color-bg-elev] px-3 py-1.5 text-xs text-[--color-fg-muted] hover:text-[--color-fg]"
              >
                Older →
              </a>
            </div>
          ) : null}
        </>
      ) : (
        <ApiUnreachable network={network} message={res.message} />
      )}
    </div>
  );
}
