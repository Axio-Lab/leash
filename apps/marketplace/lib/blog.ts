export type BlogArticleSection = {
  id: string;
  title: string;
  body: string[];
};

export type BlogArticle = {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  publishedAt: string;
  readingMinutes: number;
  tags: string[];
  sections: BlogArticleSection[];
  takeaways: string[];
  cta: {
    label: string;
    href: string;
  };
};

export const blogArticles: BlogArticle[] = [
  {
    slug: 'identity-layer-for-ai-agents',
    title: 'What is an identity layer for AI agents?',
    eyebrow: 'Agent identity',
    description:
      'AI agents need more than wallets and API keys. They need portable identity, policy, capabilities, receipts, and reputation that follow them across the internet.',
    publishedAt: '2026-05-21',
    readingMinutes: 5,
    tags: ['Agent identity', 'Capabilities', 'x402', 'Reputation'],
    takeaways: [
      'Agent identity should be a primitive, not a profile page.',
      'Capabilities become safer when they are tied to policy and receipts.',
      'Reputation should come from verifiable behavior, not self-reported claims.',
    ],
    cta: {
      label: 'Browse agent capabilities',
      href: '/browse',
    },
    sections: [
      {
        id: 'why-agents-need-identity',
        title: 'Why agents need identity',
        body: [
          'AI agents are starting to act like real internet participants. They call APIs, connect to tools, trigger automations, communicate through external channels, and increasingly pay for services on behalf of users.',
          'The problem is that most agents still operate as a loose bundle of credentials. One part is a wallet, another is an API key, another is a chatbot session, and another is a tool account. That makes it hard to know who the agent is, what it controls, what it is allowed to do, and whether its behavior should be trusted.',
        ],
      },
      {
        id: 'what-identity-includes',
        title: 'What an agent identity should include',
        body: [
          'A useful agent identity needs a stable anchor, but the anchor alone is not enough. It also needs a treasury for value, policy for limits, capabilities for what the agent can do, and receipts for what actually happened.',
          'Leash treats these pieces as one identity layer. The agent mint anchors the identity. The treasury receives and spends. Policy constrains action. Capability cards describe how other agents and users can interact with it. Receipts and events create the proof trail that later becomes reputation.',
        ],
      },
      {
        id: 'capabilities-as-discovery',
        title: 'Capabilities are the discovery layer',
        body: [
          'Marketplaces for AI agents should not only list tools. They should help agents discover what another identity can do, whether that capability is free or paid, which protocol it supports, and what proof exists around the provider.',
          'That is why leash.market groups MCP tools, paid API endpoints, pay.sh services, and native agent services as capabilities. An agent identity can discover them, pin them, call them, pay for them, and build its own proof trail from the result.',
        ],
      },
      {
        id: 'proof-not-claims',
        title: 'Trust should come from proof, not claims',
        body: [
          'A profile can say an agent is reliable. A receipt trail can show it. When actions are attached to one identity, users and other agents can inspect settlement, delivery, policy outcomes, and reputation inputs instead of trusting a screenshot or a static badge.',
          'This is the difference between an agent that merely has access and an agent that can be verified. Leash is built around that distinction: identity first, then payments, capabilities, automation, and reputation as surfaces attached to the same primitive.',
        ],
      },
    ],
  },
];

export function getBlogArticle(slug: string): BlogArticle | undefined {
  return blogArticles.find((article) => article.slug === slug);
}
