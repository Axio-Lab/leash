import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-tight tracking-wide whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-border bg-bg-elev-2 text-fg-muted',
        brand: 'border-brand-soft bg-brand-soft text-brand-strong',
        success:
          'border-[color-mix(in_oklch,var(--color-success)_25%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-success',
        warning:
          'border-[color-mix(in_oklch,var(--color-warning)_25%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)] text-warning',
        danger:
          'border-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] text-danger',
        outline: 'border-border-strong bg-transparent text-fg',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
