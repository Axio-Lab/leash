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
  title: 'leash.agent · The identity layer for AI agents',
  description: 'Create an agent identity with policy, treasury, capabilities, and receipts.',
  icons: {
    icon: '/leash-logo.png',
    shortcut: '/leash-logo.png',
    apple: '/leash-logo.png',
  },
  openGraph: {
    title: 'leash.agent · The identity layer for AI agents',
    description: 'Create an agent identity with policy, treasury, capabilities, and receipts.',
    siteName: 'leash.agents',
  },
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
          toastOptions={{
            unstyled: true,
            classNames: {
              toast:
                'group relative flex items-start gap-3 w-full pointer-events-auto rounded-xl border border-border bg-bg-elev/95 backdrop-blur-md text-fg shadow-[0_12px_40px_-12px_oklch(0_0_0/0.5)] pl-4 pr-3 pt-3 pb-3 text-sm',
              title: 'text-fg font-medium leading-snug pr-16',
              description: 'text-fg-muted text-xs leading-snug mt-0.5 pr-16',
              icon: 'text-fg-muted',
              // Float the action (e.g. "Undo") at the top-right of the toast.
              actionButton:
                '!absolute !top-2 !right-2 rounded-md bg-brand text-white px-2.5 py-1 text-xs font-medium hover:bg-brand-strong',
              cancelButton:
                'rounded-md border border-border bg-transparent text-fg-muted px-2.5 py-1 text-xs hover:bg-bg-elev-2',
              // Move the X to the bottom-right so it doesn't collide with the action.
              closeButton:
                '!absolute !bottom-2 !right-2 !top-auto !left-auto !translate-x-0 !translate-y-0 rounded-md border border-border bg-bg-elev text-fg-muted hover:text-fg hover:bg-bg-elev-2 size-6 grid place-items-center',
            },
          }}
        />
      </body>
    </html>
  );
}
