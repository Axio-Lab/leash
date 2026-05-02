'use client';

import * as React from 'react';

import { cn } from '@/lib/cn';

interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** When true uses the brand color, otherwise inherits currentColor. */
  brand?: boolean;
}

/**
 * iOS-style 12-blade spinner. Lightweight (no SVG, no JS animation) — pure
 * CSS keyframes defined in globals.css. Size maps to the bounding box; the
 * blades inside are positioned with `top/left` percentages so they always
 * scale proportionally.
 *
 * Mirrors the `<Spinner />` shipped in apps/agents and apps/marketplace
 * so loading states across the Leash product surface look identical.
 */
export function Spinner({ className, size = 'md', brand = false, ...props }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        'relative inline-block',
        size === 'xs' && 'h-3 w-3',
        size === 'sm' && 'h-3.5 w-3.5',
        size === 'md' && 'h-4 w-4',
        size === 'lg' && 'h-6 w-6',
        brand && 'text-[--color-brand]',
        className,
      )}
      {...props}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <span key={i} className="spinner-blade" />
      ))}
    </div>
  );
}
