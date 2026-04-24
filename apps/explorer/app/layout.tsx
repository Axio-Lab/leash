import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Topbar } from '@/components/topbar';
import { Footer } from '@/components/footer';
import { getNetwork } from '@/lib/server-network';
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
  title: 'Leash Explorer',
  description: 'Search agents, transactions, receipts, and events on the Leash protocol.',
  metadataBase: new URL('https://explorer.leash.market'),
  icons: {
    icon: [{ url: '/leash-svg.png', type: 'image/png' }],
    apple: '/leash-svg.png',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const network = await getNetwork();
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-dvh">
        <Topbar network={network} />
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
