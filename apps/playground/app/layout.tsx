import type { Metadata } from 'next';
import { Roboto, Roboto_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import './globals.css';

const roboto = Roboto({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300', '400', '500', '700'],
  display: 'swap',
});

const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'leash · playground',
  description: 'The operating system for agent-to-agent commerce — interactive playground.',
  metadataBase: new URL('https://playground.leash.market'),
  // Mirror apps/explorer + apps/agents: the white-inverted `leash-logo.png`
  // is the single source of truth for the brand mark across all surfaces.
  icons: {
    icon: '/leash-logo.png',
    shortcut: '/leash-logo.png',
    apple: '/leash-logo.png',
  },
  openGraph: {
    title: 'leash · playground',
    description: 'Mint agents, wire endpoints, fire payments. All from one place.',
    siteName: 'leash.playground',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `dark` matches the explorer + agents surfaces — the playground is
    // intentionally dark-first to keep brand parity. `suppressHydrationWarning`
    // on <html> and <body> is intentional: browser extensions like Grammarly
    // (data-gr-*, data-new-gr-*) and ColorZilla (cz-shortcut-listen) inject
    // attributes onto these nodes before React hydrates. The diff is cosmetic
    // and React would otherwise log a hydration mismatch on every page load.
    // This flag only silences mismatches on THIS node — children still validate
    // normally.
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} dark`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning className="min-h-dvh font-sans antialiased">
        <Providers>
          <div className="min-h-dvh flex">
            <Sidebar />
            <div className="flex flex-1 min-w-0 flex-col">
              <Topbar />
              <main className="flex-1 px-3 py-4 sm:px-5 sm:py-6 md:px-8 md:py-7">
                {/*
                 * Hard pixel cap (1500px) instead of `max-w-6xl`. Matches
                 * apps/explorer exactly so multi-app browsing doesn't shift
                 * the eye-line. Keeps line-lengths readable on ultra-wide
                 * displays (>2K) while letting cards breathe on laptops.
                 */}
                <div className="mx-auto w-full max-w-[1500px]">{children}</div>
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
