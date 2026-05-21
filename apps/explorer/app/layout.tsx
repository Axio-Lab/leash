import type { Metadata } from 'next';
import { Roboto, Roboto_Mono } from 'next/font/google';
import { Topbar } from '@/components/topbar';
import { Footer } from '@/components/footer';
import { getNetwork } from '@/lib/server-network';
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
  title: 'leash.explorer · Agent identity explorer',
  description:
    'A dual-network explorer for Leash agent identities, treasuries, proof trails, transactions, and events on Solana.',
  metadataBase: new URL('https://explorer.leash.market'),
  icons: {
    icon: '/leash-logo.png',
    shortcut: '/leash-logo.png',
    apple: '/leash-logo.png',
  },
  openGraph: {
    title: 'leash.explorer · Agent identity explorer',
    description:
      'Every agent identity created, every treasury funded, every proof receipt published.',
    siteName: 'leash.explorer',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const network = await getNetwork();
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} dark`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning className="min-h-dvh font-sans antialiased">
        <Topbar network={network} />
        <main className="mx-auto w-full max-w-[1500px] px-3 py-5 sm:px-6 sm:py-8">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
