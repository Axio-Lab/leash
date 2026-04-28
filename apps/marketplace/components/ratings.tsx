'use client';

import { cn } from '@/lib/cn';

export function StarRating({
  value,
  count,
  size = 'md',
}: {
  value: number;
  count: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn('flex', size === 'lg' ? 'text-lg' : size === 'md' ? 'text-base' : 'text-xs')}
      >
        {stars.map((s) => (
          <span key={s} className={s <= Math.round(value) ? 'text-amber-300' : 'text-fg-subtle'}>
            ★
          </span>
        ))}
      </div>
      <span className="text-xs text-fg-muted">
        {count > 0 ? `${value.toFixed(1)} (${count})` : 'no ratings'}
      </span>
    </div>
  );
}
