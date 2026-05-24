import {
  articlesGenerated20260521,
  articlesGenerated20260523,
  articlesGenerated20260524,
  type BlogArticle,
} from '@/lib/articles';

export type {
  BlogArticle,
  BlogArticleSection,
  BlogCodeBlock,
  BlogDocLink,
  BlogFaq,
} from '@/lib/articles';

export const blogArticles: BlogArticle[] = [
  ...articlesGenerated20260524,
  ...articlesGenerated20260523,
  ...articlesGenerated20260521,
];

export function getBlogArticle(slug: string): BlogArticle | undefined {
  return blogArticles.find((article) => article.slug === slug);
}

export function getRelatedArticles(article: BlogArticle): BlogArticle[] {
  return article.relatedArticles
    .map((slug) => getBlogArticle(slug))
    .filter((related): related is BlogArticle => Boolean(related));
}

export function getBlogSearchText(article: BlogArticle): string {
  return [
    article.title,
    article.seoTitle,
    article.description,
    article.seoDescription,
    article.eyebrow,
    article.category,
    article.audience,
    article.keywords.join(' '),
    article.tags.join(' '),
    article.takeaways.join(' '),
    article.faqs.map((faq) => `${faq.question} ${faq.answer}`).join(' '),
    article.docsLinks.map((link) => `${link.label} ${link.href}`).join(' '),
    article.sections
      .map((section) =>
        [
          section.title,
          section.body.join(' '),
          section.codeBlocks
            ?.map(
              (block) => `${block.title} ${block.language} ${block.caption ?? ''} ${block.code}`,
            )
            .join(' ') ?? '',
        ].join(' '),
      )
      .join(' '),
  ]
    .join(' ')
    .toLowerCase();
}
