'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';

/**
 * shadcn-style button. Variants follow the canonical
 * default/outline/ghost/secondary/destructive naming so the rest of
 * the marketplace components and any future shadcn-cli additions read
 * consistently. Uses the marketplace's `--color-*` tokens defined in
 * `globals.css`.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-bg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-brand text-white shadow-sm hover:bg-brand-strong hover:shadow-[0_8px_28px_-12px_oklch(0.7_0.22_290_/_0.6)]',
        secondary: 'bg-bg-elev-2 text-fg hover:bg-bg-elev-2/80',
        outline: 'border border-border bg-transparent hover:border-border-strong hover:bg-bg-elev',
        ghost: 'hover:bg-bg-elev hover:text-fg text-fg-muted',
        destructive: 'bg-danger text-white hover:opacity-90',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-6 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
