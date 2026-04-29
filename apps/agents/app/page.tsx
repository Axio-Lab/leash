'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { HeroShowcase } from '@/components/hero-showcase';
import { Spinner } from '@/components/ui/spinner';
// import { LiveStats } from '@/components/live-stats';

/**
 * Public landing page. Always renders the same hero (no static fallback)
 * so the "Get started" CTA is always present; logged-in users are
 * redirected to `/agents`.
 */
export default function LandingPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace('/agents');
  }, [ready, authenticated, router]);

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <BackgroundOrbs />
      <div className="relative z-10 flex min-h-dvh items-center justify-center px-6 py-16">
        <div className="grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div className="space-y-6 text-center lg:text-left">
            <span className="inline-block text-[10px] font-mono uppercase tracking-[0.25em] text-fg-subtle">
              Stablecoin rails for autonomous agents
            </span>
            <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight md:text-6xl">
              Your agent.
              <br />
              A wallet, an identity,
              <br />
              <span className="text-brand">and every tool it needs.</span>
            </h1>
            <p className="mx-auto max-w-xl text-base text-fg-muted md:text-lg lg:mx-0">
              Mint an autonomous agent on Solana, fund it with stablecoins, and watch it discover
              and pay for tools on the open MCP marketplace — every action on-chain, every payment a
              verifiable receipt.
            </p>
            <div className="flex items-center justify-center gap-4 pt-2 lg:justify-start">
              <button
                type="button"
                onClick={login}
                disabled={!ready}
                className="group inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3 text-sm font-medium text-white transition-all hover:bg-brand-strong hover:shadow-[0_0_60px_-10px_var(--color-brand)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ready ? (
                  <>
                    Get started
                    <span className="transition-transform group-hover:translate-x-0.5">→</span>
                  </>
                ) : (
                  <Spinner size="sm" />
                )}
              </button>
              {/* <a
                href="#how-it-works"
                className="text-sm text-fg-muted transition-colors hover:text-fg"
              >
                See how it works
              </a> */}
            </div>
            {/* <div className="pt-6">
              <LiveStats />
            </div> */}
          </div>
          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-4 rounded-3xl bg-linear-to-tr from-brand-soft/40 via-transparent to-brand/20 blur-2xl"
            />
            <HeroShowcase />
          </div>
        </div>
      </div>
    </main>
  );
}

function BackgroundOrbs(): React.ReactElement {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-32 -top-32 size-160 rounded-full bg-brand/20 blur-[120px] animate-orb-1" />
      <div className="absolute -bottom-32 -right-32 size-176 rounded-full bg-brand-soft/40 blur-[140px] animate-orb-2" />
      <div className="absolute inset-0 bg-[radial-gradient(transparent_60%,var(--color-bg)_100%)]" />
    </div>
  );
}
