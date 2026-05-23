import { MarketplaceHero } from '@/components/blocks/marketplace-hero';
import { CapabilityBentoSection } from '@/components/marketplace/capability-bento-section';
import { IdentityFeaturesSection } from '@/components/marketplace/identity-features-section';
import { LandingBackdrop } from '@/components/marketplace/landing-backdrop';
import { CallToAction } from '@/components/ui/cta-3';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

export default function MarketplaceLandingPage() {
  return (
    <div className="relative -mx-5 overflow-hidden px-5 pb-2">
      <LandingBackdrop />
      <div className="relative space-y-24 md:space-y-28">
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
