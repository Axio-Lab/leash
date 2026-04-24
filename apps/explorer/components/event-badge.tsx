import { cn } from '@/lib/cn';
import type { EventDescriptor } from '@/lib/event-label';

const VARIANT_CLS: Record<EventDescriptor['variant'], string> = {
  identity: 'bg-[oklch(0.32_0.1_290_/_0.5)] text-[oklch(0.85_0.15_290)]',
  executive: 'bg-[oklch(0.32_0.12_220_/_0.5)] text-[oklch(0.85_0.13_220)]',
  delegation: 'bg-[oklch(0.32_0.13_180_/_0.5)] text-[oklch(0.85_0.13_180)]',
  treasury: 'bg-[oklch(0.32_0.14_120_/_0.5)] text-[oklch(0.85_0.16_140)]',
  token: 'bg-[oklch(0.34_0.16_60_/_0.5)] text-[oklch(0.88_0.16_80)]',
  submit: 'bg-[oklch(0.3_0.02_280_/_0.7)] text-[--color-fg-muted]',
  receipt: 'bg-[oklch(0.32_0.14_320_/_0.5)] text-[oklch(0.85_0.14_320)]',
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
  prepared: 'bg-[oklch(0.3_0.02_280_/_0.7)] text-[--color-fg-muted]',
  submitted: 'bg-[oklch(0.32_0.14_60_/_0.5)] text-[oklch(0.88_0.16_70)]',
  confirmed: 'bg-[oklch(0.3_0.16_150_/_0.5)] text-[oklch(0.85_0.16_150)]',
  failed: 'bg-[oklch(0.3_0.18_25_/_0.5)] text-[oklch(0.85_0.18_25)]',
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
