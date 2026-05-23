'use client';

import Link from 'next/link';
import useSWR from 'swr';
import {
  BadgeDollarSign,
  Braces,
  DatabaseZap,
  Globe2,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Star,
  Wrench,
} from 'lucide-react';

import { BentoGrid, type BentoItem } from '@/components/ui/bento-grid';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

type DiscoverItem = {
  source: 'leash' | 'pay-skills';
  url: string;
  title: string;
  description: string;
  slug: string;
  category: string;
  price_usdc: string | null;
  pricing_type: 'free' | 'per_call' | 'variable';
  rating: number | null;
  endpoint_count?: number;
  tools: Array<{ name: string }>;
};

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<{ items: DiscoverItem[] }>;
};

const railItems = [
  'identity',
  'x402',
  'USDC',
  'MCP tools',
  'data APIs',
  'receipts',
  'policy',
  'reputation',
  'agent services',
  'pay.sh',
];

export function CapabilityBentoSection() {
  const { data, error, isLoading } = useSWR<{ items: DiscoverItem[] }>(
    '/api/discover?source=all&limit=7',
    fetcher,
  );
  const liveItems = (data?.items ?? []).slice(0, 7).map(toBentoItem);
  const items =
    liveItems.length > 0 && liveItems.length < 7 ? [...liveItems, listCapabilityItem] : liveItems;

  return (
    <section id="capabilities" className="space-y-7">
      <div className="mx-auto max-w-3xl space-y-3 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-brand-strong">
          Capability discovery
        </p>
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">
          Services agents can call once they can pay.
        </h2>
        <p className="text-pretty text-sm leading-6 text-fg-muted md:text-base">
          Search tools, data feeds, MCP servers, and agent-run services become composable once
          sellers have identity and buyers can settle per call.
        </p>
      </div>

      <SlidingRail />

      {isLoading ? (
        <div className="flex min-h-[408px] items-center justify-center rounded-xl border border-border bg-card/55">
          <div className="flex flex-col items-center gap-3 text-sm text-fg-muted">
            <Spinner size="lg" brand />
            <span>Loading live capabilities</span>
          </div>
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-fg-muted">Could not load live capabilities right now.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/browse">Open browse</Link>
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-fg-muted">No capabilities are listed yet.</p>
          <Button asChild className="mt-4">
            <Link href="/creator/list">List the first service</Link>
          </Button>
        </Card>
      ) : (
        <BentoGrid items={items} />
      )}
    </section>
  );
}

function toBentoItem(item: DiscoverItem, index: number): BentoItem {
  const href =
    item.source === 'pay-skills' ? `/capability/pay-skills/${item.slug}` : `/listing/${item.slug}`;
  const price =
    item.pricing_type === 'free'
      ? 'Free'
      : item.price_usdc
        ? `${item.price_usdc} USDC`
        : 'Variable';
  const icon = pickIcon(item, index);
  const tags = [
    item.source === 'pay-skills' ? 'pay.sh' : 'leash',
    item.category || 'service',
    item.pricing_type === 'per_call' ? 'per-call' : item.pricing_type,
  ];

  return {
    title: item.title,
    meta: price,
    description: item.description,
    icon,
    href,
    status: item.rating ? `${Math.round(item.rating * 100)} trust` : 'discoverable',
    tags,
    cta: 'View',
    colSpan: index === 0 || index === 3 ? 2 : 1,
    hasPersistentHover: index === 0,
  };
}

const listCapabilityItem: BentoItem = {
  title: 'List your capability',
  meta: 'creator',
  description:
    'Publish an MCP tool, API endpoint, or agent service so autonomous buyers can find it.',
  icon: <Sparkles className="size-4 text-brand-strong" />,
  href: '/creator/list',
  status: 'new listing',
  tags: ['identity', 'x402', 'receipts'],
  cta: 'Create',
};

function pickIcon(item: DiscoverItem, index: number) {
  const category = `${item.category} ${item.title}`.toLowerCase();
  if (item.pricing_type !== 'free') return <BadgeDollarSign className="size-4 text-success" />;
  if (category.includes('data') || category.includes('market')) {
    return <DatabaseZap className="size-4 text-brand-strong" />;
  }
  if (category.includes('mcp') || category.includes('tool')) {
    return <Wrench className="size-4 text-brand-strong" />;
  }
  if (category.includes('web') || category.includes('search')) {
    return <Globe2 className="size-4 text-brand-strong" />;
  }
  if (item.source === 'pay-skills') return <Braces className="size-4 text-fg-muted" />;
  return index % 2 === 0 ? (
    <Sparkles className="size-4 text-brand-strong" />
  ) : (
    <ShieldCheck className="size-4 text-brand-strong" />
  );
}

function SlidingRail() {
  const repeated = [...railItems, ...railItems];
  return (
    <div className="capability-rail relative overflow-hidden rounded-xl border border-border bg-bg/60 py-2">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-linear-to-r from-bg to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-linear-to-l from-bg to-transparent" />
      <div className="capability-rail-track flex w-max items-center gap-2 px-2">
        {repeated.map((item, index) => (
          <span
            key={`${item}-${index}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 font-mono text-xs uppercase tracking-widest text-fg-muted"
          >
            {index % 3 === 0 ? (
              <RadioTower className="size-3 text-brand-strong" aria-hidden="true" />
            ) : (
              <Star className="size-3 text-fg-subtle" aria-hidden="true" />
            )}
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
