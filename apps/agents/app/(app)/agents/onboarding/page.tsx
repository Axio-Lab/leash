'use client';

import Link from 'next/link';

import { OnboardingGate } from '@/components/chat/onboarding-gate';

export default function AgentsOnboardingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 text-sm">
        <Link href="/agents" className="text-fg-muted hover:text-fg">
          ← Chat
        </Link>
      </div>
      <OnboardingGate fullPage />
    </div>
  );
}
