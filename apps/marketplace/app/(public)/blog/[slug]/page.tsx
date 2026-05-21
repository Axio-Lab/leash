import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { blogArticles, getBlogArticle } from '@/lib/blog';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return blogArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getBlogArticle(slug);
  if (!article) {
    return {
      title: 'Article not found · leash.market',
    };
  }

  return {
    title: `${article.title} · leash.market`,
    description: article.description,
    openGraph: {
      title: article.title,
      description: article.description,
      type: 'article',
      publishedTime: article.publishedAt,
      tags: article.tags,
    },
  };
}

export default async function BlogArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = getBlogArticle(slug);
  if (!article) notFound();

  const published = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${article.publishedAt}T00:00:00Z`));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    author: {
      '@type': 'Organization',
      name: 'Leash',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Leash',
      logo: {
        '@type': 'ImageObject',
        url: 'https://leash.market/leash-logo.png',
      },
    },
  };

  return (
    <div className="space-y-8">
      <script
        type="application/ld+json"
        // Static article content controlled in lib/blog.ts.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link
        href="/blog"
        className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to blog
      </Link>

      <article className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-8">
          <header className="overflow-hidden rounded-xl border bg-aurora">
            <div className="bg-grid p-6 md:p-8 lg:p-10">
              <div className="max-w-3xl space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono uppercase tracking-widest">
                    {article.eyebrow}
                  </Badge>
                  <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    {published}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                    <Clock className="size-3.5" aria-hidden="true" />
                    {article.readingMinutes} min read
                  </span>
                </div>
                <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
                  {article.title}
                </h1>
                <p className="max-w-2xl text-pretty text-base leading-7 text-fg-muted md:text-lg">
                  {article.description}
                </p>
              </div>
            </div>
          </header>

          <div className="grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <nav className="sticky top-24 space-y-2" aria-label="Article sections">
                <p className="text-xs font-medium uppercase tracking-widest text-fg-subtle">
                  Sections
                </p>
                {article.sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="block rounded-md px-2 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
            </aside>

            <div className="min-w-0 space-y-8">
              {article.sections.map((section) => (
                <section key={section.id} id={section.id} className="scroll-mt-24 space-y-3">
                  <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
                  <div className="space-y-4 text-base leading-7 text-fg-muted">
                    {section.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand-strong" aria-hidden="true" />
              <h2 className="font-semibold tracking-tight">Key takeaways</h2>
            </div>
            <ul className="mt-4 space-y-3">
              {article.takeaways.map((takeaway) => (
                <li key={takeaway} className="flex gap-2 text-sm leading-6 text-fg-muted">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-brand-strong"
                    aria-hidden="true"
                  />
                  <span>{takeaway}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold tracking-tight">Explore the identity graph</h2>
            <p className="mt-2 text-sm leading-6 text-fg-muted">
              Find MCP tools, paid API endpoints, pay.sh providers, and agent services your agent
              identity can discover and pin.
            </p>
            <Button asChild className="mt-4 w-full">
              <Link href={article.cta.href}>
                {article.cta.label}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </Card>

          <div className="rounded-xl border border-dashed bg-bg-elev/40 p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-fg-subtle">Topics</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {article.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </aside>
      </article>
    </div>
  );
}
