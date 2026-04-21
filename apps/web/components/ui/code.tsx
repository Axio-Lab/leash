import * as React from 'react';
import { cn } from '@/lib/cn';

export function InlineCode({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        'rounded bg-bg-elev-2 border border-border px-1.5 py-0.5 font-mono text-[12px] text-fg',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}

export function CodeBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        'overflow-x-auto rounded-md border border-border bg-bg-elev-2/80 p-4 text-[12.5px] leading-relaxed font-mono text-fg',
        className,
      )}
    >
      {children}
    </pre>
  );
}
