import type { Metadata } from 'next';
import { Roboto, Roboto_Mono } from 'next/font/google';
import { Toaster } from 'sonner';

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
        <Toaster
          theme="dark"
          position="bottom-right"
          closeButton
          richColors
          toastOptions={{
            classNames: {
              toast:
                'bg-bg-elev/95 border border-border text-fg backdrop-blur-md shadow-[0_12px_40px_-12px_oklch(0_0_0/0.5)]',
              description: 'text-fg-muted',
              actionButton: 'bg-brand text-white',
              cancelButton: 'bg-bg-elev-2 text-fg-muted',
            },
          }}
        />
      </body>
    </html>
  );
}
