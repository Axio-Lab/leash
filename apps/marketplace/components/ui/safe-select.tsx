'use client';

import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/cn';

export type SafeSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function SafeSelect({
  id,
  value,
  options,
  onChange,
  disabled,
  className,
  buttonClassName,
  placeholder = 'Select option',
  ariaLabel,
}: {
  id?: string;
  value: string;
  options: SafeSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex min-h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-left text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand/40 disabled:opacity-50',
          buttonClassName,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-50 max-h-64 overflow-y-auto rounded-lg border border-border bg-bg-elev p-1 shadow-xl">
          <div role="listbox" aria-labelledby={id} className="space-y-1">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={option.disabled}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex min-h-10 w-full min-w-0 items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-brand/50 disabled:opacity-50',
                    active ? 'bg-brand/15 text-brand-strong' : 'text-fg-muted hover:bg-bg',
                  )}
                >
                  <Check
                    className={cn('mt-0.5 size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg">{option.label}</span>
                    {option.description ? (
                      <span className="mt-0.5 block text-xs leading-4 text-fg-subtle">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
