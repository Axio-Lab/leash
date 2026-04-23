import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Leash · Playground',
  description: 'A wallet, a leash, and a public receipt for every AI agent.',
  // Next routes /icon.svg to the file in `public/images/` via this
  // metadata entry — single source of truth for the brand mark, no
  // duplicate file in `app/`. The PNG is registered as a fallback for
  // browsers that ignore SVG favicons (e.g. older Safari).
  icons: {
    icon: [
      { url: '/images/leash_icon.svg', type: 'image/svg+xml' },
      { url: '/images/leash_icon.png', type: 'image/png', sizes: 'any' },
    ],
    shortcut: '/images/leash_icon.svg',
    apple: '/images/leash_icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` on <html> and <body> is intentional: browser
    // extensions like Grammarly (data-gr-*, data-new-gr-*) and ColorZilla
    // (cz-shortcut-listen) inject attributes onto these nodes before React
    // hydrates. The diff is cosmetic and React would otherwise log a hydration
    // mismatch on every page load. This flag only silences mismatches on THIS
    // node — children still validate normally.
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <div className="min-h-dvh flex">
            <Sidebar />
            <div className="flex flex-1 min-w-0 flex-col">
              <Topbar />
              <main className="flex-1 px-3 py-4 sm:px-5 sm:py-6 md:px-8 md:py-7">
                {/*
                 * Hard pixel cap (1500px) instead of `max-w-6xl`. With the
                 * tightened 14px root font + collapsible sidebar the legacy
                 * 6xl cap (1008px) left ~30%+ empty gutters on standard
                 * laptop/monitor widths and made cards feel marooned in a
                 * narrow center column. 1500px lets the grid layouts on
                 * /buyer, /seller, and /agents/[mint] actually breathe out
                 * to fill the viewport, while still keeping line-lengths
                 * readable on ultra-wide displays (>2K).
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
