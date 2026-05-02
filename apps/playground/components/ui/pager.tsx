'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export type PagerProps = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Optional total-items count rendered as `Showing X–Y of Z`. */
  total?: number;
  /** Page size (used only to compute the `Showing X–Y of Z` summary). */
  pageSize?: number;
  className?: string;
};

/**
 * Compact "‹ 2 / 7 ›" pager used for /seller payment-link list, the
 * receipts feed, and any other list that needs lightweight client-side
 * pagination. Keeps the button layout stable (always renders prev + next)
 * to avoid layout jank when the user clicks through pages.
 */
export function Pager({ page, pageCount, onPageChange, total, pageSize, className }: PagerProps) {
  if (pageCount <= 1) return null;
  const start = total != null && pageSize ? Math.min(total, (page - 1) * pageSize + 1) : null;
  const end = total != null && pageSize ? Math.min(total, page * pageSize) : null;
  return (
    <div className={cn('flex items-center justify-between gap-3 text-xs text-fg-muted', className)}>
      {start != null && end != null && total != null ? (
        <span>
          Showing <span className="font-mono text-fg">{start}</span>–
          <span className="font-mono text-fg">{end}</span> of{' '}
          <span className="font-mono text-fg">{total}</span>
        </span>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          <ChevronLeft className="size-3.5" /> Prev
        </Button>
        <span className="px-2 font-mono text-fg">
          {page} / {pageCount}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
        >
          Next <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Hook that pages a flat array client-side. Resets to page 1 whenever the
 * source array's identity changes (so adding/removing items doesn't strand
 * users on a now-empty page).
 */
export function usePagedItems<T>(items: T[], pageSize = 5) {
  const [page, setPage] = React.useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return {
    page,
    setPage,
    pageCount,
    pageSize,
    pageItems: items.slice(start, end),
    total: items.length,
  };
}
