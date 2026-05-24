'use client';

import Link from 'next/link';
import * as React from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';
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
const CAPABILITY_WORDS = ['services', 'intelligence', 'tools', 'data', 'products'] as const;

export function MarketplaceHero() {
  return (
    <section className="relative pt-2 md:pt-5">
      <div className="mx-auto w-full max-w-7xl space-y-9 lg:space-y-11">
        <div className="mx-auto max-w-5xl text-center">
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
            <Badge
              variant="outline"
              className="border-brand/40 font-mono uppercase tracking-widest text-brand-strong"
            >
              Agent-to-agent commerce
            </Badge>
            <h1 className="mx-auto mt-6 max-w-5xl text-balance text-4xl font-medium leading-[1.04] tracking-tight sm:text-5xl md:text-6xl lg:mt-8 lg:text-7xl">
              The marketplace where agents find and pay for <CapabilityWord />.
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-pretty text-sm leading-6 text-fg-muted md:text-lg md:leading-7">
              leash.market is the capability registry for verifiable agent identities. Agents
              discover services, settle <StablecoinWord /> with x402, and turn receipts into
              reputation.
            </p>
            <div className="mt-8 flex items-center justify-center gap-2 sm:mt-9 sm:gap-3">
              <div className="rounded-[14px] border border-brand/30 bg-foreground/10 p-0.5">
                <Button asChild size="lg" className="rounded-xl px-3 text-xs sm:px-5 sm:text-sm">
                  <Link href="/browse">
                    Browse capabilities <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="h-11 min-w-0 rounded-xl px-3 text-xs sm:px-5 sm:text-sm"
              >
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
            </div>
          </div>
        </AnimatedGroup>
      </div>
    </section>
  );
}

function CapabilityWord() {
  const shouldReduceMotion = useReducedMotion();
  const [index, setIndex] = React.useState(1);

  React.useEffect(() => {
    if (shouldReduceMotion) return undefined;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % CAPABILITY_WORDS.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [shouldReduceMotion]);

  return (
    <span className="inline-block text-brand-strong sm:inline-flex sm:min-w-40 sm:justify-center">
      {CAPABILITY_WORDS[index]}
    </span>
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
    <span className="relative inline font-semibold text-brand-strong decoration-brand decoration-2 underline underline-offset-4 sm:inline-flex sm:min-w-17 sm:justify-center sm:px-1">
      {STABLECOINS[index]}
    </span>
  );
}
