'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';

import { MarketplaceHero } from '@/components/blocks/marketplace-hero';
import { CapabilityBentoSection } from '@/components/marketplace/capability-bento-section';
import { IdentityFeaturesSection } from '@/components/marketplace/identity-features-section';
import { LandingBackdrop } from '@/components/marketplace/landing-backdrop';
import { CallToAction } from '@/components/ui/cta-3';
import { Spinner } from '@/components/ui/spinner';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

export default function MarketplaceLandingPage() {
  const router = useRouter();
  const { ready, authenticated } = usePrivy();

  React.useEffect(() => {
    if (ready && authenticated) router.replace('/creator');
  }, [authenticated, ready, router]);

  if (!ready || authenticated) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Spinner size="lg" brand />
      </div>
    );
  }

  return (
    <div className="relative left-1/2 -mt-10 w-screen -translate-x-1/2 overflow-hidden px-5 pt-2 pb-2">
      <LandingBackdrop />
      <div className="relative mx-auto w-full max-w-[1240px] space-y-24 md:space-y-28">
        <MarketplaceHero />
        <CapabilityBentoSection />
        <IdentityFeaturesSection />
        <AgentBuilderCta />
      </div>
    </div>
  );
}

function AgentBuilderCta() {
  return (
    <section>
      <CallToAction
        eyebrow="Ready for autonomous spend"
        title="Build an agent that can buy what it needs."
        description="Mint a verifiable identity, set policy, and let your agent discover services, pay in USDC, and keep receipts for every call."
        primary={{
          label: 'Create an agent',
          href: NEXT_PUBLIC_AGENTS_URL,
          external: true,
        }}
        secondary={{
          label: 'List a service',
          href: '/creator/list',
        }}
      />
    </section>
  );
}
