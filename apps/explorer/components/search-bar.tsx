'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { resolveSearch, searchHitToHref } from '@/lib/search';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';

export function SearchBar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const hit = resolveSearch(value);
    if (!hit.value) return;
    const href = searchHitToHref(hit);
    startTransition(() => router.push(href));
  }

  // `min-w-0` lets the input shrink inside its `flex-1` parent on narrow
  // viewports — without it Flexbox preserves the placeholder's intrinsic
  // width and pushes the search bar past the topbar's right edge. The
  // `truncate`-style trio (overflow-hidden + ellipsis + nowrap) lets
  // the verbose placeholder gracefully clip with `…` instead of
  // overflowing on a 360-px-wide phone.
  const inputCls = cn(
    'w-full min-w-0 truncate bg-transparent outline-none placeholder:text-[--color-fg-subtle]',
    size === 'lg' && 'text-base',
    size === 'sm' && 'text-xs',
  );

  const padCls = cn(
    'group flex items-center gap-2 rounded-xl border border-[--color-border] bg-[--color-bg-elev]/70 backdrop-blur-md transition-all',
    'focus-within:border-[--color-brand-strong] focus-within:bg-[--color-bg-elev]/90',
    'focus-within:shadow-[0_0_0_1px_oklch(0.66_0.19_268/0.35),0_12px_40px_-16px_oklch(0.66_0.19_268/0.4)]',
    size === 'lg' && 'px-4 py-3',
    size === 'md' && 'px-3 py-2',
    size === 'sm' && 'px-2 py-1.5',
  );

  return (
    <form onSubmit={onSubmit} className="w-full min-w-0">
      <label className={padCls}>
        {pending ? (
          <Spinner size={size === 'lg' ? 'sm' : 'xs'} className="text-[--color-fg-subtle]" />
        ) : (
          <Search className="h-4 w-4 shrink-0 text-[--color-fg-subtle] transition-colors group-focus-within:text-[--color-brand]" />
        )}
        <input
          type="text"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search handle, address, tx signature, receipt hash, or event id"
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
    </form>
  );
}
