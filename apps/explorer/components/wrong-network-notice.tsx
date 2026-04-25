'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { setNetworkAction } from '@/app/network-actions';
import { NETWORK_LABEL, networkToSlug, type Network } from '@/lib/network';
import { cn } from '@/lib/cn';

type Props = {
  /** The network the user is viewing (where the record is missing). */
  current: Network;
  /** The network where we found the record. */
  other: Network;
  /** What we looked for, e.g. "transaction", "receipt", "agent", "event". */
  entity: string;
  /** The lookup key as the user typed it (signature / hash / mint / id). */
  identifier: string;
};

/**
 * Banner shown on detail pages when the user is viewing the wrong
 * cluster for the record they searched for. One-click "Switch to <X>"
 * flips the network cookie and re-fetches the same URL — so the next
 * render hits the same `/tx/abc…` route but with the right cluster
 * context, no rebuild of the URL needed.
 */
export function WrongNetworkNotice({ current, other, entity, identifier }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function switchAndRefresh() {
    if (pending) return;
    startTransition(async () => {
      await setNetworkAction(other);
      router.refresh();
    });
  }

  return (
    <div className="card flex flex-col gap-3 border-[--color-warning] bg-[oklch(0.22_0.06_70)] px-5 py-4 text-sm sm:flex-row sm:items-center">
      <div className="flex-1 space-y-1">
        <p className="font-medium text-[--color-fg]">
          This {entity} doesn&rsquo;t exist on{' '}
          <span className="font-mono">{networkToSlug(current)}</span>.
        </p>
        <p className="text-xs text-[--color-fg-muted]">
          We found a match on <span className="font-mono">{networkToSlug(other)}</span>. Switch
          networks to view it. Identifier:{' '}
          <span className="break-all font-mono text-[--color-fg-subtle]">{identifier}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={switchAndRefresh}
        disabled={pending}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[--color-border-strong] bg-[--color-brand-soft] px-3 py-1.5 text-xs font-medium text-[--color-fg] transition-opacity',
          pending ? 'opacity-60' : 'hover:bg-[--color-brand]',
        )}
      >
        Switch to {NETWORK_LABEL[other]}
        <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * Companion empty state for "no record at all" — used when neither
 * cluster has the identifier. Differentiates a real miss from a
 * wrong-network miss.
 */
export function NoRecordFound({
  entity,
  identifier,
  network,
}: {
  entity: string;
  identifier: string;
  network: Network;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[--color-border] bg-[--color-bg-elev] px-6 py-10 text-center">
      <p className="text-sm font-medium text-[--color-fg]">No {entity} found</p>
      <p className="mt-1 break-all font-mono text-xs text-[--color-fg-muted]">{identifier}</p>
      <p className="mt-3 text-xs text-[--color-fg-subtle]">
        Searched both networks. Confirm the {entity} exists, or try a different cluster (currently{' '}
        <span className="font-mono">{networkToSlug(network)}</span>).
      </p>
    </div>
  );
}
