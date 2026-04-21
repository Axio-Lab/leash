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
              <main className="flex-1 px-6 py-8 md:px-10">
                <div className="mx-auto w-full max-w-6xl">{children}</div>
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
