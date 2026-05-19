import { notFound } from 'next/navigation';
import { BadgeCheck, IdCard, LockKeyhole } from 'lucide-react';

import { DbUnavailableError, getIdentityDisclosureByToken } from '@/lib/db';
import { DbUnreachable } from '@/components/empty';
import { Mono } from '@/components/mono';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

export default async function DisclosurePage({ params }: Props) {
  const { token } = await params;
  let data;
  try {
    data = await getIdentityDisclosureByToken(token);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return <DbUnreachable network="disclosure" message={err.message} />;
    }
    throw err;
  }
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <header className="card-glow space-y-4 px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-[--color-border] bg-[--color-bg-elev]/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[--color-fg-muted] backdrop-blur-md">
            <LockKeyhole className="h-3 w-3 text-[--color-brand]" />
            Selective disclosure
          </span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-[--color-fg]">
            {data.agent.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[--color-fg-muted]">
            <IdCard className="h-4 w-4" />
            <Mono value={data.agent.mint} truncate copy={false} />
            {data.agent.handle ? <span>@{data.agent.handle}</span> : null}
            <span>{data.agent.network}</span>
          </div>
        </div>
        <p className="text-sm text-[--color-fg-muted]">
          This page shows private identity resources the owner explicitly disclosed. It expires on{' '}
          {new Date(data.expires_at).toLocaleString()}.
        </p>
      </header>

      <section className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-[--color-fg-subtle]">
          <BadgeCheck className="h-4 w-4" />
          Capability cards
        </h2>
        {data.resources.capability_cards.length === 0 ? (
          <p className="text-sm text-[--color-fg-muted]">No capability cards disclosed.</p>
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2">
            {data.resources.capability_cards.map((card) => (
              <li
                key={card.id}
                className="rounded-xl border border-[--color-border] bg-[--color-bg-elev]/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[--color-fg]">{card.title}</span>
                  <span className="rounded-full bg-[--color-brand-soft]/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[--color-brand-strong]">
                    {card.visibility}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[--color-fg-muted]">{card.kind}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[--color-fg-subtle]">
          Claims
        </h2>
        {data.resources.claims.length === 0 ? (
          <p className="text-sm text-[--color-fg-muted]">No claims disclosed.</p>
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2">
            {data.resources.claims.map((claim) => (
              <li
                key={claim.id}
                className="rounded-xl border border-[--color-border] bg-[--color-bg-elev]/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[--color-fg]">{claim.type}</span>
                  <span className="text-[11px] text-[--color-fg-subtle]">{claim.issuer}</span>
                </div>
                <p className="mt-1 text-xs text-[--color-fg-muted]">{claim.value}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[--color-fg-subtle]">
          Receipts
        </h2>
        {data.resources.receipts.length === 0 ? (
          <p className="text-sm text-[--color-fg-muted]">No receipts disclosed.</p>
        ) : (
          <ul className="space-y-2">
            {data.resources.receipts.map((receipt, index) => (
              <li
                key={`${String(receipt.receipt_hash ?? index)}`}
                className="rounded-xl border border-[--color-border] bg-[--color-bg-elev]/40 p-3"
              >
                <pre className="overflow-x-auto text-xs text-[--color-fg-muted]">
                  {JSON.stringify(receipt, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
