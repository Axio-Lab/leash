export type BlogCodeBlock = {
  title: string;
  language: string;
  code: string;
  caption?: string;
};

export type BlogArticleSection = {
  id: string;
  title: string;
  body: string[];
  codeBlocks?: BlogCodeBlock[];
};

export type BlogFaq = {
  question: string;
  answer: string;
};

export type BlogDocLink = {
  label: string;
  href: string;
};

export type BlogArticle = {
  slug: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  eyebrow: string;
  description: string;
  category: string;
  audience: string;
  publishedAt: string;
  readingMinutes: number;
  keywords: string[];
  tags: string[];
  sections: BlogArticleSection[];
  takeaways: string[];
  faqs: BlogFaq[];
  docsLinks: BlogDocLink[];
  relatedArticles: string[];
  cta: {
    label: string;
    href: string;
  };
};

export type ProgrammaticArticleSpec = {
  slug: string;
  title: string;
  seoTitle?: string;
  seoDescription?: string;
  eyebrow: string;
  category: string;
  audience: string;
  description: string;
  keywords: string[];
  tags: string[];
  takeaways: string[];
  useCase: string;
  mechanics: string;
  checklist: string;
  codeBlocks?: BlogCodeBlock[];
  faqs: BlogFaq[];
  docsLinks: BlogDocLink[];
  relatedArticles: string[];
  cta?: BlogArticle['cta'];
};

const DOCS_URL = 'https://docs.leash.market';

export function docs(path: string, label: string): BlogDocLink {
  return { label, href: `${DOCS_URL}${path}` };
}

function lines(value: string[]): string {
  return value.join('\n');
}

export function codeBlock(
  title: string,
  language: string,
  code: string[],
  caption?: string,
): BlogCodeBlock {
  return { title, language, code: lines(code), ...(caption ? { caption } : {}) };
}

export function makeGuideArticle(spec: ProgrammaticArticleSpec): BlogArticle {
  return {
    slug: spec.slug,
    title: spec.title,
    seoTitle: spec.seoTitle ?? `${spec.title} | Leash guide`,
    seoDescription: spec.seoDescription ?? spec.description,
    eyebrow: spec.eyebrow,
    description: spec.description,
    category: spec.category,
    audience: spec.audience,
    publishedAt: '2026-05-21',
    readingMinutes: spec.codeBlocks && spec.codeBlocks.length > 0 ? 7 : 5,
    keywords: spec.keywords,
    tags: spec.tags,
    takeaways: spec.takeaways,
    faqs: spec.faqs,
    docsLinks: spec.docsLinks,
    relatedArticles: spec.relatedArticles,
    cta: spec.cta ?? { label: 'Browse agent capabilities', href: '/browse' },
    sections: [
      {
        id: 'why-it-matters',
        title: 'Why it matters',
        body: [
          spec.useCase,
          'Leash is the identity layer for AI agents, so the work is not treated as a loose wallet, API key, or dashboard setting. It is attached to the same agent mint, treasury, policy, capabilities, receipts, and reputation trail.',
        ],
      },
      {
        id: 'how-leash-handles-it',
        title: 'How Leash handles it',
        body: [
          spec.mechanics,
          'That makes the result portable across the agent app, marketplace, explorer, CLI, MCP server, SDK, buyer kit, seller kit, and playground. The surface can change, but the identity and proof trail stay the same.',
        ],
      },
      {
        id: 'implementation-checklist',
        title: 'Implementation checklist',
        body: [
          spec.checklist,
          `For a production integration, start with the smallest path that proves the identity loop: create or resolve an agent, attach the capability, set policy, run one real action, then verify the receipt or event on the explorer.`,
        ],
        ...(spec.codeBlocks && spec.codeBlocks.length > 0 ? { codeBlocks: spec.codeBlocks } : {}),
      },
    ],
  };
}
