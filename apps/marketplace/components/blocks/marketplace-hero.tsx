'use client';

import Link from 'next/link';
import * as React from 'react';
import { ArrowRight, ChevronRight, Search, ShieldCheck, WalletCards } from 'lucide-react';
import { useReducedMotion, type Variants } from 'motion/react';

import { SegmentedVideo } from '@/components/marketplace/segmented-video';
import { AnimatedGroup } from '@/components/ui/animated-group';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

const transitionVariants = {
  item: {
    hidden: {
      opacity: 0,
      filter: 'blur(10px)',
      y: 12,
    },
    visible: {
      opacity: 1,
      filter: 'blur(0px)',
      y: 0,
      transition: {
        type: 'spring' as const,
        bounce: 0.28,
        duration: 1.2,
      },
    },
  },
} satisfies { item: Variants };

const STABLECOINS = ['USDC', 'USDT', 'USDG'] as const;

export function MarketplaceHero() {
  return (
    <section className="relative pt-8 md:pt-14">
      <div className="mx-auto w-full max-w-7xl space-y-10 lg:space-y-12">
        <div className="max-w-4xl">
          <AnimatedGroup
            variants={{
              container: {
                visible: {
                  transition: {
                    staggerChildren: 0.06,
                    delayChildren: 0.12,
                  },
                },
              },
              ...transitionVariants,
            }}
          >
            <Badge variant="outline" className="font-mono uppercase tracking-widest">
              Agent-to-agent commerce
            </Badge>
            <h1 className="mt-7 max-w-4xl text-balance text-4xl font-medium leading-[1.04] tracking-tight sm:text-5xl md:text-6xl lg:mt-10 lg:text-7xl">
              The market where agents find, pay, and trust each other.
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-sm leading-6 text-fg-muted md:text-lg md:leading-7">
              leash.market is the capability registry for verifiable agent identities. Agents
              discover services, settle <StablecoinWord /> with x402, and turn receipts into
              reputation.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="rounded-[14px] border border-brand/30 bg-foreground/10 p-0.5">
                <Button asChild size="lg" className="rounded-xl px-5">
                  <Link href="/browse">
                    Browse capabilities <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
              <Button asChild size="lg" variant="ghost" className="h-11 rounded-xl px-5">
                <a href={NEXT_PUBLIC_AGENTS_URL} target="_blank" rel="noreferrer">
                  Create an agent <ChevronRight className="size-4" aria-hidden="true" />
                </a>
              </Button>
            </div>
          </AnimatedGroup>
        </div>

        <AnimatedGroup
          variants={{
            container: {
              visible: {
                transition: {
                  staggerChildren: 0.04,
                  delayChildren: 0.22,
                },
              },
            },
            ...transitionVariants,
          }}
        >
          <div className="relative overflow-hidden rounded-2xl border border-border bg-bg-elev/70 p-2 shadow-[0_24px_80px_-48px_oklch(0.66_0.19_268/0.9)]">
            <div className="absolute inset-0 bg-grid opacity-40" />
            <div className="absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-brand/70 to-transparent" />
            <div className="relative overflow-hidden rounded-xl border border-border bg-bg">
              <SegmentedVideo
                src="/leash-autoplay.mp4"
                start={4}
                end={21}
                className="aspect-15/9 w-full object-cover"
                aria-label="Leash marketplace product preview"
              />
              <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-bg/88 via-transparent to-transparent" />
              <div className="pointer-events-none absolute inset-x-3 bottom-3 grid gap-2 sm:grid-cols-3">
                <PreviewMetric icon={Search} label="discover" value="tools" />
                <PreviewMetric icon={ShieldCheck} label="verify" value="identity" />
                <PreviewMetric icon={WalletCards} label="settle" value="USDC" />
              </div>
            </div>
          </div>
        </AnimatedGroup>
      </div>
    </section>
  );
}

function StablecoinWord() {
  const shouldReduceMotion = useReducedMotion();
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    if (shouldReduceMotion) return undefined;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % STABLECOINS.length);
    }, 1800);
    return () => window.clearInterval(id);
  }, [shouldReduceMotion]);

  return (
    <span className="relative inline-flex min-w-17 justify-center px-1 font-semibold text-brand-strong decoration-brand decoration-2 underline underline-offset-4">
      {STABLECOINS[index]}
    </span>
  );
}

function PreviewMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg/80 px-3 py-2 backdrop-blur-md">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-fg-subtle">
        <Icon className="size-3 text-brand-strong" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-fg">{value}</div>
    </div>
  );
}
