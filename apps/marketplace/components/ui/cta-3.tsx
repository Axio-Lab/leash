import Link from 'next/link';
import type * as React from 'react';
import { ArrowRightIcon, PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

type Action = {
  label: string;
  href: string;
  external?: boolean;
};

type CallToActionProps = {
  eyebrow?: string;
  title: string;
  description: string;
  primary: Action;
  secondary?: Action;
  className?: string;
};

export function CallToAction({
  eyebrow,
  title,
  description,
  primary,
  secondary,
  className,
}: CallToActionProps) {
  return (
    <div
      className={cn(
        'relative mx-auto flex w-full max-w-7xl flex-col justify-between gap-y-6 rounded-xl border border-border bg-[radial-gradient(35%_80%_at_25%_0%,oklch(1_0_0/0.08),transparent)] px-4 py-8 md:px-8',
        className,
      )}
    >
      <PlusIcon
        className="absolute left-[-11.5px] top-[-12.5px] z-10 size-6 text-fg-subtle"
        strokeWidth={1}
        aria-hidden="true"
      />
      <PlusIcon
        className="absolute right-[-11.5px] top-[-12.5px] z-10 size-6 text-fg-subtle"
        strokeWidth={1}
        aria-hidden="true"
      />
      <PlusIcon
        className="absolute bottom-[-12.5px] left-[-11.5px] z-10 size-6 text-fg-subtle"
        strokeWidth={1}
        aria-hidden="true"
      />
      <PlusIcon
        className="absolute bottom-[-12.5px] right-[-11.5px] z-10 size-6 text-fg-subtle"
        strokeWidth={1}
        aria-hidden="true"
      />

      <div className="pointer-events-none absolute -inset-y-6 left-0 w-px border-l border-border" />
      <div className="pointer-events-none absolute -inset-y-6 right-0 w-px border-r border-border" />
      <div className="absolute left-1/2 top-0 -z-10 h-full border-l border-dashed border-border" />

      <div className="space-y-2 text-center">
        {eyebrow ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-brand-strong">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-fg md:text-3xl">
          {title}
        </h2>
        <p className="mx-auto max-w-xl text-pretty text-sm leading-6 text-fg-muted md:text-base">
          {description}
        </p>
      </div>

      <div className="flex items-center justify-center gap-2 sm:gap-3">
        {secondary ? (
          <div className="rounded-[14px] border border-brand/30 bg-foreground/10 p-0.5">
            <Button asChild size="lg" className="rounded-xl px-3 text-xs sm:px-5 sm:text-sm">
              <ActionLink action={secondary} />
            </Button>
          </div>
        ) : null}
        <Button
          asChild
          size="lg"
          variant="ghost"
          className="h-11 min-w-0 rounded-xl px-3 text-xs sm:px-5 sm:text-sm"
        >
          <ActionLink action={primary}>
            <span>{primary.label}</span>
            <ArrowRightIcon className="ml-1 size-4" aria-hidden="true" />
          </ActionLink>
        </Button>
      </div>
    </div>
  );
}

function ActionLink({
  action,
  children,
  ...props
}: {
  action: Action;
  children?: React.ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const content = children ?? action.label;

  if (action.external) {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" {...props}>
        {content}
      </a>
    );
  }

  return (
    <Link href={action.href} {...props}>
      {content}
    </Link>
  );
}
