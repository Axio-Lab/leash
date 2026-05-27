import { describe, expect, it } from 'vitest';

import { blogArticles, getBlogSearchText, getRelatedArticles } from '@/lib/blog';

describe('programmatic blog articles', () => {
  it('ships the existing articles plus the latest marketplace SEO guides', () => {
    expect(blogArticles).toHaveLength(52);
    expect(blogArticles[0]?.slug).toBe('how-agents-create-their-own-leash-api-keys');
  });

  it('keeps article slugs unique and related links resolvable', () => {
    const slugs = new Set(blogArticles.map((article) => article.slug));
    expect(slugs.size).toBe(blogArticles.length);

    for (const article of blogArticles) {
      for (const related of article.relatedArticles) {
        expect(related).not.toBe(article.slug);
        expect(slugs.has(related)).toBe(true);
      }
      expect(getRelatedArticles(article).length).toBe(article.relatedArticles.length);
    }
  });

  it('requires SEO metadata, FAQs, docs links, and searchable text', () => {
    for (const article of blogArticles) {
      expect(article.seoTitle.length).toBeGreaterThan(20);
      expect(article.seoDescription.length).toBeGreaterThan(40);
      expect(article.keywords.length).toBeGreaterThanOrEqual(3);
      expect(article.faqs.length).toBeGreaterThanOrEqual(2);
      expect(article.docsLinks.length).toBeGreaterThanOrEqual(2);
      expect(getBlogSearchText(article)).toContain(article.title.toLowerCase());
      expect(getBlogSearchText(article)).toContain(article.faqs[0]!.question.toLowerCase());
    }
  });

  it('covers the planned Leash surfaces', () => {
    const categories = new Set(blogArticles.map((article) => article.category));
    expect(categories).toEqual(
      new Set([
        'API',
        'Agent infrastructure',
        'Agents app',
        'Facilitator',
        'Identity layer',
        'Marketplace',
        'Packages',
        'Playground',
      ]),
    );
  });

  it('includes code examples across developer surfaces', () => {
    const articlesWithCode = blogArticles.filter((article) =>
      article.sections.some((section) => (section.codeBlocks?.length ?? 0) > 0),
    );
    expect(articlesWithCode.length).toBeGreaterThanOrEqual(24);

    const searchText = blogArticles.map(getBlogSearchText).join(' ');
    expect(searchText).toContain('verifycapabilityseller');
    expect(searchText).toContain('@leashmarket/mcp');
    expect(searchText).toContain('@leashmarket/seller-kit');
    expect(searchText).toContain('@leashmarket/buyer-kit');
    expect(searchText).toContain('leash_facilitator_url');
    expect(searchText).toContain('payment-required');
  });
});
