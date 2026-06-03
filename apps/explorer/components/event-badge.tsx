import { cn } from '@/lib/cn';
import type { EventDescriptor } from '@/lib/event-label';

/**
 * Tonal pills for event variants. Each tone leans into the protocol's
 * mental model (identity = indigo, treasury = green, receipt = magenta,
 * …) but stays within the explorer's muted palette so a row of pills
 * never overpowers the surrounding text. Borders + soft glows let them
 * read on the frosted-glass cards introduced for the agents-style
 * refresh.
 */
const VARIANT_CLS: Record<EventDescriptor['variant'], string> = {
  identity:
    'bg-[oklch(0.32_0.1_290/0.5)] text-[oklch(0.85_0.15_290)] ring-1 ring-inset ring-[oklch(0.5_0.18_290/0.3)]',
  executive:
    'bg-[oklch(0.32_0.12_220/0.5)] text-[oklch(0.85_0.13_220)] ring-1 ring-inset ring-[oklch(0.5_0.18_220/0.3)]',
  delegation:
    'bg-[oklch(0.32_0.13_180/0.5)] text-[oklch(0.85_0.13_180)] ring-1 ring-inset ring-[oklch(0.5_0.18_180/0.3)]',
  'native-subscription':
    'bg-[oklch(0.31_0.13_205/0.5)] text-[oklch(0.86_0.15_205)] ring-1 ring-inset ring-[oklch(0.5_0.18_205/0.3)]',
  treasury:
    'bg-[oklch(0.32_0.14_120/0.5)] text-[oklch(0.85_0.16_140)] ring-1 ring-inset ring-[oklch(0.5_0.18_140/0.3)]',
  token:
    'bg-[oklch(0.34_0.16_60/0.5)] text-[oklch(0.88_0.16_80)] ring-1 ring-inset ring-[oklch(0.5_0.18_80/0.3)]',
  submit:
    'bg-[oklch(0.3_0.02_280/0.7)] text-[--color-fg-muted] ring-1 ring-inset ring-[oklch(0.4_0.02_280/0.4)]',
  receipt:
    'bg-[oklch(0.32_0.14_320/0.5)] text-[oklch(0.85_0.14_320)] ring-1 ring-inset ring-[oklch(0.5_0.18_320/0.3)]',
  'payment-link':
    'bg-[oklch(0.32_0.13_30/0.5)] text-[oklch(0.88_0.15_40)] ring-1 ring-inset ring-[oklch(0.5_0.18_40/0.3)]',
  buyer:
    'bg-[oklch(0.32_0.12_260/0.5)] text-[oklch(0.85_0.14_260)] ring-1 ring-inset ring-[oklch(0.5_0.18_260/0.3)]',
  'protocol-fee':
    'bg-[oklch(0.32_0.16_85/0.55)] text-[oklch(0.9_0.18_95)] ring-1 ring-inset ring-[oklch(0.5_0.2_95/0.35)]',
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
  prepared:
    'bg-[oklch(0.3_0.02_280/0.7)] text-[--color-fg-muted] ring-1 ring-inset ring-[oklch(0.4_0.02_280/0.4)]',
  submitted:
    'bg-[oklch(0.32_0.14_60/0.5)] text-[oklch(0.88_0.16_70)] ring-1 ring-inset ring-[oklch(0.5_0.18_70/0.3)]',
  confirmed:
    'bg-[oklch(0.3_0.16_150/0.5)] text-[oklch(0.85_0.16_150)] ring-1 ring-inset ring-[oklch(0.5_0.18_150/0.3)]',
  failed:
    'bg-[oklch(0.3_0.18_25/0.5)] text-[oklch(0.85_0.18_25)] ring-1 ring-inset ring-[oklch(0.5_0.2_25/0.3)]',
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
