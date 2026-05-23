import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  Code2,
  ExternalLink,
  HelpCircle,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { blogArticles, getBlogArticle, getRelatedArticles } from '@/lib/blog';

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
    title: article.seoTitle,
    description: article.seoDescription,
    keywords: article.keywords,
    alternates: {
      canonical: `https://leash.market/blog/${article.slug}`,
    },
    openGraph: {
      title: article.seoTitle,
      description: article.seoDescription,
      type: 'article',
      publishedTime: article.publishedAt,
      tags: article.tags,
      url: `https://leash.market/blog/${article.slug}`,
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

  const relatedArticles = getRelatedArticles(article);
  const articleJsonLd = {
    '@type': 'Article',
    headline: article.title,
    description: article.seoDescription,
    datePublished: article.publishedAt,
    dateModified: article.publishedAt,
    articleSection: article.category,
    keywords: article.keywords.join(', '),
    mainEntityOfPage: `https://leash.market/blog/${article.slug}`,
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
  const faqJsonLd =
    article.faqs.length > 0
      ? {
          '@type': 'FAQPage',
          mainEntity: article.faqs.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: faq.answer,
            },
          })),
        }
      : null;
  const jsonLd = faqJsonLd
    ? { '@context': 'https://schema.org', '@graph': [articleJsonLd, faqJsonLd] }
    : { '@context': 'https://schema.org', ...articleJsonLd };

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
                  <Badge
                    variant="outline"
                    className="border-brand/40 font-mono uppercase tracking-widest text-brand-strong"
                  >
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
                  <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                    {article.category}
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
                {article.faqs.length > 0 ? (
                  <a
                    href="#faq"
                    className="block rounded-md px-2 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    FAQ
                  </a>
                ) : null}
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
                  {section.codeBlocks && section.codeBlocks.length > 0 ? (
                    <div className="space-y-4 pt-2">
                      {section.codeBlocks.map((block) => (
                        <div
                          key={`${section.id}-${block.title}`}
                          className="overflow-hidden rounded-xl border border-border bg-bg-elev/70"
                        >
                          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Code2 className="size-4 text-brand-strong" aria-hidden="true" />
                              <p className="text-sm font-medium tracking-tight">{block.title}</p>
                            </div>
                            <span className="rounded-md border border-border px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-fg-subtle">
                              {block.language}
                            </span>
                          </div>
                          <pre className="overflow-x-auto p-4 text-sm leading-6">
                            <code className="font-mono text-fg">{block.code}</code>
                          </pre>
                          {block.caption ? (
                            <p className="border-t border-border px-4 py-3 text-xs leading-5 text-fg-muted">
                              {block.caption}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              ))}

              {article.faqs.length > 0 ? (
                <section id="faq" className="scroll-mt-24 space-y-4">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="size-5 text-brand-strong" aria-hidden="true" />
                    <h2 className="text-2xl font-semibold tracking-tight">FAQ</h2>
                  </div>
                  <div className="space-y-3">
                    {article.faqs.map((faq) => (
                      <div key={faq.question} className="rounded-xl border bg-bg-elev/40 p-4">
                        <h3 className="font-medium tracking-tight">{faq.question}</h3>
                        <p className="mt-2 text-sm leading-6 text-fg-muted">{faq.answer}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
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

          {article.docsLinks.length > 0 ? (
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <BookOpen className="size-4 text-brand-strong" aria-hidden="true" />
                <h2 className="font-semibold tracking-tight">Read the docs</h2>
              </div>
              <div className="mt-4 space-y-2">
                {article.docsLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    <span>{link.label}</span>
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                  </a>
                ))}
              </div>
            </Card>
          ) : null}

          {relatedArticles.length > 0 ? (
            <Card className="p-5">
              <h2 className="font-semibold tracking-tight">Related guides</h2>
              <div className="mt-4 space-y-2">
                {relatedArticles.map((related) => (
                  <Link
                    key={related.slug}
                    href={`/blog/${related.slug}`}
                    className="block rounded-md border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    {related.title}
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}

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
