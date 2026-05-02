import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-brand/15 text-brand-strong',
        secondary: 'border-transparent bg-bg-elev-2 text-fg-muted',
        outline: 'border-border text-fg-muted',
        success: 'border-transparent bg-emerald-950/40 text-emerald-300',
        warning: 'border-transparent bg-amber-950/40 text-amber-300',
        danger: 'border-transparent bg-rose-950/40 text-rose-300',
        free: 'border-transparent bg-emerald-950/40 text-emerald-300',
        paid: 'border-transparent bg-amber-950/40 text-amber-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
