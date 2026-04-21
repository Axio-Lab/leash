import * as React from 'react';
import { cn } from '@/lib/cn';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2 md:flex-row md:items-end md:justify-between', className)}>
      <div className="flex flex-col gap-1">
        {eyebrow ? (
          <span className="text-[11px] font-medium uppercase tracking-widest text-brand">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="text-sm text-fg-muted max-w-2xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
