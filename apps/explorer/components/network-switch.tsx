'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setNetworkAction } from '@/app/network-actions';
import type { Network } from '@/lib/network';
import { cn } from '@/lib/cn';

export function NetworkSwitch({ value }: { value: Network }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function pick(next: Network) {
    if (next === value || pending) return;
    startTransition(async () => {
      await setNetworkAction(next);
      router.refresh();
    });
  }

  return (
    <div
      role="tablist"
      aria-label="Network"
      className={cn(
        'inline-flex items-center rounded-full border border-[--color-border] bg-[--color-bg-elev] p-0.5 text-xs',
        pending && 'opacity-60',
      )}
    >
      {(['devnet', 'mainnet'] as const).map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => pick(opt)}
            className={cn(
              'relative px-3 py-1 rounded-full transition-colors',
              active
                ? 'bg-[--color-brand-soft] text-[--color-fg]'
                : 'text-[--color-fg-muted] hover:text-[--color-fg]',
            )}
          >
            <span className="font-medium tracking-wide capitalize">{opt}</span>
          </button>
        );
      })}
    </div>
  );
}
