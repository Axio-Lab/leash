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
        'relative mx-auto flex w-full max-w-3xl flex-col justify-between gap-y-6 border-y border-border bg-[radial-gradient(35%_80%_at_25%_0%,oklch(1_0_0/0.08),transparent)] px-4 py-8 md:px-8',
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
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-fg-subtle">
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

      <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        {secondary ? (
          <Button asChild variant="outline">
            <ActionLink action={secondary} />
          </Button>
        ) : null}
        <Button asChild>
          <ActionLink action={primary}>
            <span>{primary.label}</span>
            <ArrowRightIcon className="ml-1 size-4" aria-hidden="true" />
          </ActionLink>
        </Button>
      </div>
    </div>
  );
}

function ActionLink({ action, children }: { action: Action; children?: React.ReactNode }) {
  const content = children ?? action.label;

  if (action.external) {
    return (
      <a href={action.href} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }

  return <Link href={action.href}>{content}</Link>;
}
