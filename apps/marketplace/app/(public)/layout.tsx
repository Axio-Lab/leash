import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

/**
 * Marketing chrome — site header and footer. Used by `/`, `/browse`,
 * and the listing detail pages. The creator dashboard owns its own
 * full-bleed sidebar chrome under `(creator)`.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1 mx-auto w-full max-w-[1240px] px-5 py-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
