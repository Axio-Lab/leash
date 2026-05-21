import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { blogArticles } from '@/lib/blog';

const POSTS_PER_PAGE = 10;

export const metadata: Metadata = {
  title: 'Blog · leash.market',
  description:
    'Practical writing on AI agent identity, capabilities, payments, receipts, and reputation.',
};

type BlogIndexPageProps = {
  searchParams?: Promise<{ page?: string | string[] }>;
};

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? '1');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageHref(page: number): string {
  return page <= 1 ? '/blog' : `/blog?page=${page}`;
}

export default async function BlogIndexPage({ searchParams }: BlogIndexPageProps) {
  const requestedPage = parsePage((await searchParams)?.page);
  const totalPages = Math.max(1, Math.ceil(blogArticles.length / POSTS_PER_PAGE));
  const clampedPage = Math.min(requestedPage, totalPages);
  const visibleArticles = blogArticles.slice(
    (clampedPage - 1) * POSTS_PER_PAGE,
    clampedPage * POSTS_PER_PAGE,
  );

  return (
    <div className="space-y-10">
      <header className="max-w-3xl space-y-4">
        <Badge variant="outline" className="font-mono uppercase tracking-widest">
          Leash blog
        </Badge>
        <div className="space-y-3">
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Notes on agent identity and capabilities.
          </h1>
          <p className="max-w-2xl text-pretty text-base text-fg-muted md:text-lg">
            Guides and essays for builders giving AI agents identity, policy, payments, proof
            trails, and real capabilities.
          </p>
        </div>
      </header>

      <section aria-label="Articles" className="grid gap-4 md:grid-cols-2">
        {visibleArticles.map((article) => (
          <Link
            key={article.slug}
            href={`/blog/${article.slug}`}
            className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <Card className="h-full p-5 transition-colors hover:border-border-strong hover:bg-bg-elev-2/70">
              <div className="flex h-full flex-col gap-5">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="secondary">{article.eyebrow}</Badge>
                  <span className="text-xs text-fg-subtle">{article.readingMinutes} min read</span>
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold leading-tight tracking-tight">
                    {article.title}
                  </h2>
                  <p className="line-clamp-3 text-sm leading-6 text-fg-muted">
                    {article.description}
                  </p>
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                  <div className="flex flex-wrap gap-1.5">
                    {article.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="text-xs text-fg-subtle">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span className="inline-flex size-9 items-center justify-center rounded-md border border-border text-fg-muted transition-colors group-hover:border-brand/50 group-hover:text-brand-strong">
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </span>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </section>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-2">
          {clampedPage <= 1 ? (
            <Button type="button" variant="outline" size="sm" disabled>
              Previous
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(clampedPage - 1)}>Previous</Link>
            </Button>
          )}
          <span className="px-2 text-xs text-fg-muted">
            {clampedPage} / {totalPages}
          </span>
          {clampedPage >= totalPages ? (
            <Button type="button" variant="outline" size="sm" disabled>
              Next
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(clampedPage + 1)}>Next</Link>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
