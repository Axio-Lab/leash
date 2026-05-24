import type { MetadataRoute } from 'next';

import { blogArticles } from '@/lib/blog';

const SITE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? 'https://leash.market').replace(
  /\/+$/,
  '',
);

function url(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: url('/'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: url('/browse'),
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: url('/blog'),
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: url('/llms.txt'),
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.7,
    },
  ];

  const articleRoutes: MetadataRoute.Sitemap = blogArticles.map((article) => ({
    url: url(`/blog/${article.slug}`),
    lastModified: new Date(`${article.publishedAt}T00:00:00.000Z`),
    changeFrequency: 'monthly',
    priority: article.slug === 'monetize-api-endpoint-with-leash-seller-kit' ? 0.95 : 0.75,
  }));

  return [...staticRoutes, ...articleRoutes];
}
