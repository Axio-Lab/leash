'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2 } from 'lucide-react';
import { resolveSearch, searchHitToHref } from '@/lib/search';
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

  const inputCls = cn(
    'w-full bg-transparent outline-none placeholder:text-[--color-fg-subtle]',
    size === 'lg' && 'text-base',
    size === 'sm' && 'text-xs',
  );
  const padCls = cn(
    'flex items-center gap-2 rounded-xl border border-[--color-border] bg-[--color-bg-elev] focus-within:border-[--color-brand-strong] transition-colors',
    size === 'lg' && 'px-4 py-3',
    size === 'md' && 'px-3 py-2',
    size === 'sm' && 'px-2 py-1.5',
  );

  return (
    <form onSubmit={onSubmit} className="w-full">
      <label className={padCls}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin text-[--color-fg-subtle]" />
        ) : (
          <Search className="h-4 w-4 text-[--color-fg-subtle]" />
        )}
        <input
          type="text"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search address, tx signature, receipt hash, or event id"
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
    </form>
  );
}
