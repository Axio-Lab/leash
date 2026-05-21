import { BookOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mb-6 flex min-h-[calc(100dvh-18rem)] flex-col">
      <div>{children}</div>
      <div className="mt-auto pt-14">
        <section className="rounded-xl border bg-bg-elev p-5 md:flex md:items-center md:justify-between md:gap-6">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-brand/30 bg-brand/10 text-brand-strong">
              <BookOpen className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold tracking-tight">Building with Leash?</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">
                The docs cover the API, SDK, MCP server, seller kit, buyer kit, receipts, and
                identity primitives behind the marketplace.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="mt-4 md:mt-0">
            <a href="https://docs.leash.market" target="_blank" rel="noreferrer">
              Read docs
            </a>
          </Button>
        </section>
      </div>
    </div>
  );
}
