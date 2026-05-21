import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { blogArticles, getBlogSearchText } from '@/lib/blog';

const POSTS_PER_PAGE = 10;

export const metadata: Metadata = {
  title: 'Blog · leash.market',
  description:
    'Practical writing on AI agent identity, capabilities, payments, receipts, and reputation.',
};

type BlogIndexPageProps = {
  searchParams?: Promise<{ page?: string | string[]; q?: string | string[] }>;
};

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? '1');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim();
}

function pageHref(page: number, query: string): string {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (query.length > 0) params.set('q', query);
  const qs = params.toString();
  return qs ? `/blog?${qs}` : '/blog';
}

function matchesArticleSearch(article: (typeof blogArticles)[number], query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return getBlogSearchText(article).includes(needle);
}

export default async function BlogIndexPage({ searchParams }: BlogIndexPageProps) {
  const params = await searchParams;
  const query = parseQuery(params?.q);
  const requestedPage = parsePage(params?.page);
  const filteredArticles = blogArticles.filter((article) => matchesArticleSearch(article, query));
  const totalPages = Math.max(1, Math.ceil(filteredArticles.length / POSTS_PER_PAGE));
  const clampedPage = Math.min(requestedPage, totalPages);
  const visibleArticles = filteredArticles.slice(
    (clampedPage - 1) * POSTS_PER_PAGE,
    clampedPage * POSTS_PER_PAGE,
  );

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl space-y-4">
          <Badge variant="outline" className="font-mono uppercase tracking-widest">
            Leash blog
          </Badge>
          <div className="space-y-3">
            <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
              Articles on agent identity and capabilities.
            </h1>
            <p className="max-w-2xl text-pretty text-base text-fg-muted md:text-lg">
              Guides and essays for builders giving AI agents identity, policy, payments, proof
              trails, and real capabilities.
            </p>
          </div>
        </div>

        <form action="/blog" className="w-full max-w-sm lg:pt-8" role="search">
          <label htmlFor="blog-search" className="sr-only">
            Search blog articles
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
                aria-hidden="true"
              />
              <Input
                id="blog-search"
                name="q"
                type="search"
                defaultValue={query}
                placeholder="Search articles"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </div>
          {query.length > 0 ? (
            <Link
              href="/blog"
              className="mt-2 inline-flex text-xs text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Clear search
            </Link>
          ) : null}
        </form>
      </header>

      {visibleArticles.length > 0 ? (
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
                    <span className="text-xs text-fg-subtle">
                      {article.readingMinutes} min read
                    </span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold leading-tight tracking-tight">
                      {article.title}
                    </h2>
                    <p className="text-xs font-medium uppercase tracking-widest text-fg-subtle">
                      {article.category} · {article.audience}
                    </p>
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
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-bg-elev/40 p-12 text-center text-sm text-fg-muted">
          No blog articles match this search.
          <Link href="/blog" className="ml-1 text-brand hover:underline">
            View all articles
          </Link>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-2">
          {clampedPage <= 1 ? (
            <Button type="button" variant="outline" size="sm" disabled>
              Previous
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(clampedPage - 1, query)}>Previous</Link>
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
              <Link href={pageHref(clampedPage + 1, query)}>Next</Link>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
