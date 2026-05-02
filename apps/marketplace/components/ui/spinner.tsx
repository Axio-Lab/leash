'use client';

import * as React from 'react';

import { cn } from '@/lib/cn';

interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  brand?: boolean;
}

/**
 * iOS-style 12-blade spinner. Pure CSS animation; see `.spinner-blade` rules
 * in `app/globals.css`.
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
        brand && 'text-brand',
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
