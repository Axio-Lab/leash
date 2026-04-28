import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { AgentsPrivyProvider } from '@/lib/privy-provider';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Leash · Agents',
  description: 'Your agent. A wallet, an identity, and every tool it needs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AgentsPrivyProvider>{children}</AgentsPrivyProvider>
      </body>
    </html>
  );
}
