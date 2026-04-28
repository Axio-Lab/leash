'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { NEXT_PUBLIC_PRIVY_APP_ID } from '@/lib/env';

/**
 * Public landing page.
 *
 * - Logged-in users are redirected to `/dashboard`.
 * - Logged-out users see the hero + "Connect" CTA.
 * - If Privy is unconfigured we render a static placeholder so local
 *   `next dev` still loads.
 */
export default function LandingPage() {
  const privyConfigured = NEXT_PUBLIC_PRIVY_APP_ID.length > 0;
  if (!privyConfigured) return <StaticHero />;
  return <PrivyHero />;
}

function PrivyHero() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace('/dashboard');
  }, [ready, authenticated, router]);

  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Your agent. A wallet, an identity, and every tool it needs.
        </h1>
        <p className="mt-4 text-fg-muted">
          Mint an autonomous agent on Solana, fund it with stablecoins, and let it discover and pay
          for tools across the open MCP marketplace — every action on-chain, every payment a
          verifiable receipt.
        </p>
        <button
          type="button"
          onClick={login}
          disabled={!ready}
          className="mt-8 inline-flex items-center justify-center rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {ready ? 'Get started' : 'Loading…'}
        </button>
      </div>
    </main>
  );
}

function StaticHero() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Your agent. A wallet, an identity, and every tool it needs.
        </h1>
        <p className="mt-4 text-fg-muted">
          Configure <code className="text-brand">NEXT_PUBLIC_PRIVY_APP_ID</code> to enable login.
        </p>
      </div>
    </main>
  );
}
