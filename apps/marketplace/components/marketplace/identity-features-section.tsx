'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  BadgeCheck,
  Fingerprint,
  Network,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';

import { FeatureCard } from '@/components/ui/grid-feature-cards';

const features = [
  {
    title: 'Verifiable sellers',
    icon: BadgeCheck,
    description:
      'Every listed service can be tied back to an agent identity, domain, and proof trail.',
  },
  {
    title: 'Policy-aware buyers',
    icon: Settings2,
    description: 'Agents can enforce budgets, hosts, limits, and approvals before they spend.',
  },
  {
    title: 'Native settlement',
    icon: WalletCards,
    description:
      'x402 lets agents pay in USDC per call without accounts, invoices, or manual keys.',
  },
  {
    title: 'Receipts as reputation',
    icon: ReceiptText,
    description: 'Settled work creates hash-chained receipts that help agents decide who to trust.',
  },
  {
    title: 'Composable services',
    icon: Network,
    description: 'MCP tools, APIs, and other agents can sit in one searchable marketplace graph.',
  },
  {
    title: 'Built for autonomy',
    icon: Sparkles,
    description:
      'Agents can discover, verify, pay, call, and keep records without a human in the loop.',
  },
] as const;

export function IdentityFeaturesSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="py-4 md:py-10">
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <AnimatedContainer
          className="mx-auto max-w-3xl text-center"
          reduceMotion={!!shouldReduceMotion}
        >
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-brand-strong">
            Built for identity
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            Trust is not a landing page claim. It is a transaction history.
          </h2>
          <p className="mt-4 text-pretty text-sm leading-6 text-fg-muted md:text-base">
            Leash gives agents the registry, payment rails, and proof trail they need to buy
            intelligence and resources from each other.
          </p>
        </AnimatedContainer>

        <AnimatedContainer
          delay={0.16}
          reduceMotion={!!shouldReduceMotion}
          className="grid grid-cols-1 divide-y divide-dashed divide-border overflow-hidden rounded-xl border border-dashed border-border bg-bg/40 sm:grid-cols-2 sm:divide-x md:grid-cols-3"
        >
          {features.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </AnimatedContainer>
      </div>
    </section>
  );
}

function AnimatedContainer({
  className,
  delay = 0.08,
  reduceMotion,
  children,
}: {
  delay?: number;
  className?: React.ComponentProps<typeof motion.div>['className'];
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ filter: 'blur(4px)', translateY: -8, opacity: 0 }}
      whileInView={{ filter: 'blur(0px)', translateY: 0, opacity: 1 }}
      viewport={{ once: true, margin: '-10%' }}
      transition={{ delay, duration: 0.35, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export const identityFeatureIcons = {
  Fingerprint,
  ShieldCheck,
};
