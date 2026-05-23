'use client';

import * as React from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, CheckCircle, Clock, Globe, Star, TrendingUp, Video } from 'lucide-react';

import { cn } from '@/lib/cn';

type CardStyle = React.CSSProperties & {
  '--spotlight-x'?: string;
  '--spotlight-y'?: string;
};

export interface BentoItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  href?: string;
  status?: string;
  tags?: string[];
  meta?: string;
  cta?: string;
  colSpan?: number;
  hasPersistentHover?: boolean;
}

interface BentoGridProps {
  items?: BentoItem[];
  className?: string;
}

const itemsSample: BentoItem[] = [
  {
    title: 'Analytics Dashboard',
    meta: 'v2.4.1',
    description: 'Real-time metrics with AI-powered insights and predictive analytics',
    icon: <TrendingUp className="size-4 text-brand-strong" />,
    status: 'Live',
    tags: ['Statistics', 'Reports', 'AI'],
    colSpan: 2,
    hasPersistentHover: true,
  },
  {
    title: 'Task Manager',
    meta: '84 completed',
    description: 'Automated workflow management with priority scheduling',
    icon: <CheckCircle className="size-4 text-success" />,
    status: 'Updated',
    tags: ['Productivity', 'Automation'],
  },
  {
    title: 'Media Library',
    meta: '12GB used',
    description: 'Cloud storage with intelligent content processing',
    icon: <Video className="size-4 text-brand" />,
    tags: ['Storage', 'CDN'],
    colSpan: 2,
  },
  {
    title: 'Global Network',
    meta: '6 regions',
    description: 'Multi-region deployment with edge computing',
    icon: <Globe className="size-4 text-fg-muted" />,
    status: 'Beta',
    tags: ['Infrastructure', 'Edge'],
  },
];

export function BentoGrid({ items = itemsSample, className }: BentoGridProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className={cn('grid grid-cols-1 gap-3 md:grid-cols-3', className)}>
      {items.map((item, index) => (
        <BentoGridItem
          key={`${item.title}-${index}`}
          item={item}
          index={index}
          reduceMotion={!!shouldReduceMotion}
        />
      ))}
    </div>
  );
}

function BentoGridItem({
  item,
  index,
  reduceMotion,
}: {
  item: BentoItem;
  index: number;
  reduceMotion: boolean;
}) {
  const [spotlight, setSpotlight] = React.useState<CardStyle>({
    '--spotlight-x': '50%',
    '--spotlight-y': '50%',
  });

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setSpotlight({
      '--spotlight-x': `${((event.clientX - rect.left) / rect.width) * 100}%`,
      '--spotlight-y': `${((event.clientY - rect.top) / rect.height) * 100}%`,
    });
  };

  const content = (
    <>
      <div
        className={cn(
          'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100',
          item.hasPersistentHover && 'opacity-100',
        )}
        style={{
          background:
            'radial-gradient(320px circle at var(--spotlight-x) var(--spotlight-y), oklch(0.66 0.19 268 / 0.22), transparent 52%)',
        }}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100',
          item.hasPersistentHover && 'opacity-100',
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,oklch(1_0_0/0.045)_1px,transparent_1px)] bg-[length:4px_4px]" />
      </div>

      <div className="relative flex min-h-[172px] flex-col justify-between gap-5">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="grid size-9 place-items-center rounded-lg border border-border bg-bg/70 transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:border-brand/50 group-hover:bg-brand/10 group-focus-visible:border-brand/50">
              {item.icon}
            </div>
            <span className="rounded-md border border-border bg-bg/70 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-fg-muted backdrop-blur-sm">
              {item.status ?? 'Active'}
            </span>
          </div>

          <div className="space-y-2">
            <h3 className="text-[15px] font-medium tracking-tight text-fg">
              {item.title}
              {item.meta ? (
                <span className="ml-2 font-mono text-xs font-normal text-fg-subtle">
                  {item.meta}
                </span>
              ) : null}
            </h3>
            <p className="text-sm leading-snug text-fg-muted">{item.description}</p>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
            {item.tags?.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border bg-bg/70 px-2 py-1 font-mono transition-colors duration-150 group-hover:border-border-strong group-hover:text-fg-muted"
              >
                #{tag}
              </span>
            ))}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted opacity-100 transition-[opacity,transform,color] duration-150 group-hover:translate-x-0.5 group-hover:text-brand-strong md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
            {item.cta ?? 'Explore'} <ArrowRight className="size-3" aria-hidden="true" />
          </span>
        </div>
      </div>
    </>
  );

  const className = cn(
    'capability-card-glide group relative block h-full overflow-hidden rounded-xl border border-border bg-card p-4 outline-none',
    'transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out',
    'hover:-translate-y-1 hover:border-brand/50 hover:shadow-[0_18px_70px_-42px_oklch(0.66_0.19_268/0.75)]',
    'focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    item.colSpan === 2 && 'md:col-span-2',
    item.hasPersistentHover &&
      '-translate-y-0.5 border-brand/40 shadow-[0_18px_70px_-48px_oklch(0.66_0.19_268/0.85)]',
  );

  if (item.href) {
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, x: index % 2 === 0 ? -18 : 18 }}
        whileInView={reduceMotion ? undefined : { opacity: 1, x: 0 }}
        viewport={{ once: true, margin: '-10%' }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: Math.min(index * 0.04, 0.18) }}
        className={cn(item.colSpan === 2 && 'md:col-span-2')}
      >
        <Link
          href={item.href}
          className={className}
          style={spotlight}
          onPointerMove={onPointerMove}
        >
          {content}
        </Link>
      </motion.div>
    );
  }

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, x: index % 2 === 0 ? -18 : 18 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-10%' }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: Math.min(index * 0.04, 0.18) }}
      className={className}
      style={spotlight}
      onPointerMove={onPointerMove}
    >
      {content}
    </motion.article>
  );
}

export const bentoIcons = {
  Clock,
  Globe,
  Star,
  TrendingUp,
};
