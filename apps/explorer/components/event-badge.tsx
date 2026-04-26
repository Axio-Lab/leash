import { cn } from '@/lib/cn';
import type { EventDescriptor } from '@/lib/event-label';

const VARIANT_CLS: Record<EventDescriptor['variant'], string> = {
  identity: 'bg-[oklch(0.32_0.1_290/0.5)] text-[oklch(0.85_0.15_290)]',
  executive: 'bg-[oklch(0.32_0.12_220/0.5)] text-[oklch(0.85_0.13_220)]',
  delegation: 'bg-[oklch(0.32_0.13_180/0.5)] text-[oklch(0.85_0.13_180)]',
  treasury: 'bg-[oklch(0.32_0.14_120/0.5)] text-[oklch(0.85_0.16_140)]',
  token: 'bg-[oklch(0.34_0.16_60/0.5)] text-[oklch(0.88_0.16_80)]',
  submit: 'bg-[oklch(0.3_0.02_280/0.7)] text-[--color-fg-muted]',
  receipt: 'bg-[oklch(0.32_0.14_320/0.5)] text-[oklch(0.85_0.14_320)]',
  'payment-link': 'bg-[oklch(0.32_0.13_30/0.5)] text-[oklch(0.88_0.15_40)]',
  buyer: 'bg-[oklch(0.32_0.12_260/0.5)] text-[oklch(0.85_0.14_260)]',
  'protocol-fee': 'bg-[oklch(0.32_0.16_85/0.55)] text-[oklch(0.9_0.18_95)]',
};

export function EventBadge({
  descriptor,
  className,
}: {
  descriptor: EventDescriptor;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        VARIANT_CLS[descriptor.variant],
        className,
      )}
    >
      {descriptor.shortLabel}
    </span>
  );
}

const PHASE_CLS = {
  prepared: 'bg-[oklch(0.3_0.02_280/0.7)] text-[--color-fg-muted]',
  submitted: 'bg-[oklch(0.32_0.14_60/0.5)] text-[oklch(0.88_0.16_70)]',
  confirmed: 'bg-[oklch(0.3_0.16_150/0.5)] text-[oklch(0.85_0.16_150)]',
  failed: 'bg-[oklch(0.3_0.18_25/0.5)] text-[oklch(0.85_0.18_25)]',
} as const;

export function PhaseBadge({
  phase,
  className,
}: {
  phase: 'prepared' | 'submitted' | 'confirmed' | 'failed';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        PHASE_CLS[phase],
        className,
      )}
    >
      {phase}
    </span>
  );
}
