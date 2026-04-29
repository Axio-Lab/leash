import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter } from 'next/font/google';

import { AuthButton } from '@/components/auth-button';
import { MarketplacePrivyProvider } from '@/lib/privy-provider';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'leash.market · Leash registry for autonomous agents',
  description:
    'An open registry of MCP tools agents can discover, rate, and pay per call. Stablecoin rails for autonomous agents.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <MarketplacePrivyProvider>
          <div className="min-h-dvh flex flex-col">
            <header className="border-b px-5 py-3 flex items-center gap-6">
              <Link href="/" className="font-semibold tracking-tight">
                leash<span className="text-fg-muted">.market</span>
              </Link>
              <nav className="text-sm text-fg-muted flex items-center gap-4">
                <Link href="/" className="hover:text-fg">
                  Browse
                </Link>
                <Link href="/dev" className="hover:text-fg">
                  For developers
                </Link>
              </nav>
              <div className="ml-auto flex items-center gap-3">
                <Link
                  href={process.env.NEXT_PUBLIC_AGENTS_URL ?? 'http://localhost:4100'}
                  className="rounded-md border px-3 py-1.5 text-xs hover:border-border-strong"
                >
                  Open agent dashboard →
                </Link>
                <AuthButton />
              </div>
            </header>
            <main className="flex-1 px-5 py-8 mx-auto w-full max-w-[1200px]">{children}</main>
          </div>
        </MarketplacePrivyProvider>
      </body>
    </html>
  );
}
