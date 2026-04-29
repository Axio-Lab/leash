import type { Metadata } from 'next';
import { Roboto, Roboto_Mono } from 'next/font/google';

import { AgentsPrivyProvider } from '@/lib/privy-provider';
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
  title: 'Leash · Agents',
  description: 'Your agent. A wallet, an identity, and every tool it needs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} dark`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning className="font-sans antialiased">
        <AgentsPrivyProvider>{children}</AgentsPrivyProvider>
      </body>
    </html>
  );
}
