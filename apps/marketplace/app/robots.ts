import type { MetadataRoute } from 'next';

const SITE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? 'https://leash.market').replace(
  /\/+$/,
  '',
);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/browse', '/blog', '/listing'],
        disallow: ['/creator', '/api', '/_next'],
      },
      {
        userAgent: 'Googlebot',
        allow: ['/', '/browse', '/blog', '/listing'],
        disallow: ['/creator', '/api', '/_next'],
      },
      {
        userAgent: [
          'GPTBot',
          'ChatGPT-User',
          'ClaudeBot',
          'Claude-User',
          'PerplexityBot',
          'OAI-SearchBot',
          'Google-Extended',
        ],
        allow: ['/', '/browse', '/blog', '/llms.txt'],
        disallow: ['/creator', '/api', '/_next'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
