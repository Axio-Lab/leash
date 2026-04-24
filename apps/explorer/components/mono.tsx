import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { shortAddr } from '@/lib/format';
import { CopyButton } from './copy-button';

type Props = {
  value: string | null | undefined;
  href?: string;
  external?: string;
  truncate?: boolean;
  className?: string;
  copy?: boolean;
};

export function Mono({ value, href, external, truncate = true, className, copy = true }: Props) {
  if (!value) return <span className="text-[--color-fg-subtle]">—</span>;
  const text = truncate ? shortAddr(value, 6, 6) : value;
  const span = (
    <span className={cn('font-mono text-xs leading-none', truncate && 'tracking-tight', className)}>
      {text}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {href ? (
        <Link
          href={href}
          className="text-[--color-brand] hover:text-[--color-brand-strong] transition-colors"
          title={value}
        >
          {span}
        </Link>
      ) : (
        <span title={value}>{span}</span>
      )}
      {copy ? <CopyButton value={value} label="Copy address" /> : null}
      {external ? (
        <a
          href={external}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[--color-fg-subtle] hover:text-[--color-fg] transition-colors"
          title="View on Solscan"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </span>
  );
}
