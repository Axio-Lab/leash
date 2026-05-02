'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setNetworkAction } from '@/app/network-actions';
import type { Network } from '@/lib/network';
import { cn } from '@/lib/cn';

/**
 * Two-state pill that swaps the network cookie and re-fetches the page.
 * Visual matches the segmented controls used across apps/agents — a
 * frosted-glass track with a brand-tinted thumb on the active option.
 */
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
        'relative inline-flex items-center rounded-full border border-[--color-border] bg-[--color-bg-elev]/70 p-0.5 text-xs backdrop-blur-md transition-opacity',
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
              'relative px-3 py-1 rounded-full transition-all',
              active
                ? 'bg-[--color-brand-soft] text-[--color-fg] shadow-[0_0_0_1px_oklch(0.66_0.19_268/0.4),0_8px_24px_-12px_oklch(0.66_0.19_268/0.5)]'
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
