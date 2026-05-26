import type { Metadata } from 'next';
import { Roboto, Roboto_Mono } from 'next/font/google';
import { Toaster } from 'sonner';

import { MarketplacePrivyProvider } from '@/lib/privy-provider';
import './globals.css';

const SITE_URL = 'https://leash.market';

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
  metadataBase: new URL(SITE_URL),
  applicationName: 'Leash Marketplace',
  title: {
    default: 'leash.market · Capability registry for AI agents',
    template: '%s · Leash Market',
  },
  description:
    'Discover, list, monetize, and pay for AI agent capabilities with Leash identity, x402, MPP, stablecoin settlement, receipts, and reputation.',
  keywords: [
    'AI agent marketplace',
    'x402 marketplace',
    'agent payments',
    'AI agent identity',
    'monetize API endpoint',
    'paid agent services',
    'Leash marketplace',
  ],
  alternates: {
    canonical: '/',
    types: {
      'text/plain': '/llms.txt',
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
  verification: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
      ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
      : {}),
  },
  icons: {
    icon: '/leash-logo.png',
    shortcut: '/leash-logo.png',
    apple: '/leash-logo.png',
  },
  openGraph: {
    title: 'Leash Market · Capability registry for AI agents',
    description:
      'Discover, list, monetize, and pay for AI agent capabilities with Leash identity, x402, MPP, receipts, and reputation.',
    url: '/',
    siteName: 'leash.market',
    type: 'website',
    images: [
      {
        url: '/leash-logo.png',
        width: 512,
        height: 512,
        alt: 'Leash logo',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Leash Market · Capability registry for AI agents',
    description:
      'Discover, list, monetize, and pay for AI agent capabilities with Leash identity, x402, MPP, receipts, and reputation.',
    images: ['/leash-logo.png'],
  },
};

/**
 * The root layout is intentionally chrome-free. Public marketing routes
 * (`/`, `/browse`, `/listing/[slug]`) render their own header inside
 * the route segment. The `(creator)` route group ships a fully
 * sidebar-driven dashboard layout. Keeping chrome-free here means each
 * surface can choose its own width, gutter, and theming.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} dark`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning className="font-sans antialiased min-h-dvh">
        <MarketplacePrivyProvider>{children}</MarketplacePrivyProvider>
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
