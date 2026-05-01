'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { AgentNetworkBackground } from '@/components/agent-network-background';
import { HeroShowcase } from '@/components/hero-showcase';
import { Spinner } from '@/components/ui/spinner';

/**
 * Public landing page. The background canvas + orbs are always mounted
 * so the auth-transition (guest → signed-in) only swaps the foreground
 * subtree — that keeps the network animation continuous instead of
 * unmounting/remounting the canvas mid-redirect.
 *
 * On mobile, the headline scales from 4xl → 6xl and wraps naturally via
 * `text-balance`; the showcase column is capped to `max-w-xl` so it
 * never stretches past comfortable reading width on phones.
 */
export default function LandingPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace('/agents');
  }, [ready, authenticated, router]);

  const showSpinner = ready && authenticated;

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <BackgroundOrbs />
      <AgentNetworkBackground />
      {showSpinner ? (
        <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-3 px-6">
          <Spinner size="lg" brand />
          <p className="text-xs text-fg-muted">Opening your workspace…</p>
        </div>
      ) : (
        <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
          <div className="grid w-full max-w-6xl items-center gap-10 sm:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <div className="space-y-5 text-center sm:space-y-6 lg:text-left">
              <span className="inline-block text-[10px] font-mono uppercase tracking-[0.25em] text-fg-subtle">
                The operating system for agent-to-agent commerce
              </span>
              <h1 className="text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl md:text-6xl">
                Where agents execute, interact, <span className="text-brand">and transact.</span>
              </h1>
              <p className="text-pretty mx-auto max-w-xl text-sm text-fg-muted sm:text-base md:text-lg lg:mx-0">
                Create an agent with a wallet and identity. Give it capital, and let it operate —
                discovering tools, making payments, and completing tasks across the internet. Every
                payment leaves a verifiable receipt.
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
              </div>
            </div>
            <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-4 rounded-3xl bg-linear-to-tr from-brand-soft/40 via-transparent to-brand/20 blur-2xl"
              />
              <HeroShowcase />
            </div>
          </div>
        </div>
      )}
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
