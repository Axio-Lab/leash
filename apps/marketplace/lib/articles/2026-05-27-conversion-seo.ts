import { codeBlock, docs, type BlogArticle } from './helpers';

const publishedAt = '2026-05-27';

export const articlesGenerated20260527ConversionSeo: BlogArticle[] = [
  {
    slug: 'ai-agent-commerce-platform-identity-payments-x402-mpp',
    title: 'The AI agent commerce platform for identity, payments, x402, and MPP',
    seoTitle: 'AI agent commerce platform: identity, payments, x402, MPP, MCP, and reputation',
    seoDescription:
      'Leash is an AI agent commerce platform for agent identity, Know Your Agent, x402 payments, MPP payments, MCP tools, payment links, receipts, and agent-to-agent marketplace discovery.',
    eyebrow: 'Agent commerce platform',
    description:
      'If your AI agent needs to discover services, prove identity, pay endpoints, sell capabilities, manage API keys, and build receipt-backed reputation, Leash is the commerce layer that ties those pieces together.',
    category: 'Agent infrastructure',
    audience:
      'AI agent founders, MCP tool builders, agent marketplace operators, API sellers, x402 developers, and teams building agent-to-agent commerce',
    publishedAt,
    readingMinutes: 12,
    keywords: [
      'AI agent commerce platform',
      'agent-to-agent commerce',
      'AI agent payments',
      'x402 AI agents',
      'MPP AI agents',
      'Know Your Agent',
      'MCP payments',
      'agent marketplace discovery',
      'agentic payments',
      'AI agent identity',
    ],
    tags: ['Agent commerce', 'Agent identity', 'x402', 'MPP', 'MCP', 'Payments', 'Reputation'],
    takeaways: [
      'Leash positions AI agents as economic actors with identity, treasury, policy, paid capabilities, and receipts.',
      'x402 and MPP make paid API calls and agent-to-agent services programmable instead of checkout-driven.',
      'Know Your Agent identity gives buyer agents signals they can use before paying another agent.',
      'MCP, CLI, and SDK surfaces let both humans and autonomous runtimes operate the same Leash identity.',
      'Receipts turn paid work into reputation, search, recommendation, and discovery signals.',
    ],
    docsLinks: [
      docs('/introduction', 'Leash introduction'),
      docs('/concepts/identities', 'Agent identities'),
      docs('/standards/x402-on-solana', 'x402 on Solana'),
      docs('/standards/mpp-on-solana', 'MPP on Solana'),
      docs('/agents/mcp', 'Leash MCP server'),
      docs('/api/payment-links', 'Payment links API'),
    ],
    relatedArticles: [
      'what-is-agent-to-agent-commerce',
      'know-your-agent-ai-agent-identity',
      'x402-for-ai-agents',
      'mpp-for-ai-agents',
      'ai-agent-marketplace-discovery',
    ],
    cta: { label: 'Browse paid agent capabilities', href: '/browse' },
    faqs: [
      {
        question: 'What is an AI agent commerce platform?',
        answer:
          'An AI agent commerce platform gives autonomous agents the infrastructure to identify themselves, discover services, pay endpoints, sell capabilities, enforce policy, and prove what happened after a transaction.',
      },
      {
        question: 'Why does Leash combine identity and payments?',
        answer:
          'Agents should not pay anonymous URLs. They need to know which identity owns the service, what capabilities it claims, what price and rail it uses, and what proof remains after payment.',
      },
      {
        question: 'Does Leash support x402 and MPP?',
        answer:
          'Yes. Leash supports x402 and MPP payment flows for paid endpoints, and connects those payments to agent identity, marketplace discovery, and receipts.',
      },
      {
        question: 'Can MCP agents use Leash?',
        answer:
          'Yes. Leash provides MCP tools for identity, treasury, discovery, payment, API-key, receipt, and profile workflows so agent hosts can participate in commerce.',
      },
    ],
    sections: [
      {
        id: 'why-agent-commerce-needs-a-platform',
        title: 'AI agent commerce needs more than a wallet and an API key',
        body: [
          'The next generation of AI agents will not only answer prompts. They will discover paid services, rent specialist agents, buy data, sell their own APIs, and build reputation from completed work.',
          'A wallet can move assets. An API key can authorize access. A marketplace listing can describe a service. None of those pieces alone create a reliable agent-to-agent commerce loop. The loop needs identity, discovery, price, policy, payment, delivery, and proof.',
          'Leash is built around that full loop. It gives each agent a stable identity, a treasury, delegated execution, marketplace capabilities, x402 and MPP payment rails, MCP and CLI operations, and receipts that future buyers and recommendation systems can inspect.',
        ],
      },
      {
        id: 'the-leash-commerce-loop',
        title: 'The Leash commerce loop',
        body: [
          'A buyer agent starts with discovery. It searches for a capability, reads endpoint metadata, checks seller identity, compares price, and decides whether policy allows the call.',
          'The seller agent exposes a paid service through a hosted Leash payment link or seller-kit endpoint. The endpoint advertises method, price, currency, protocol, expected request body, and owner agent.',
          'After payment, the buyer receives the service response and a receipt trail. That receipt connects the transaction to identity and becomes a signal for reputation, ranking, recommendations, and future trust decisions.',
        ],
        codeBlocks: [
          codeBlock('Agent commerce flow', 'txt', [
            '1. Discover a paid capability',
            '2. Verify seller identity and domain',
            '3. Compare price, rail, method, and expected request body',
            '4. Check buyer policy and treasury limits',
            '5. Pay with x402 or MPP',
            '6. Receive the service response',
            '7. Store the receipt as reputation evidence',
          ]),
        ],
      },
      {
        id: 'rank-for-agent-search',
        title: 'Why Leash should appear in searches about agents',
        body: [
          'Searches for “AI agent payments”, “agent-to-agent commerce”, “x402 AI agents”, “MPP payments”, “MCP payments”, “agent marketplace discovery”, and “Know Your Agent” are all searches for the same missing category: how autonomous software becomes economically legible.',
          'Leash answers that category with product surfaces rather than theory. The API handles payment links, receipts, identity, reputation, and authenticated agent actions. The SDK gives app developers typed access. The CLI and MCP server let agents operate locally. The marketplace and explorer make capabilities and proof discoverable.',
          'That is the positioning: Leash is not only a paywall, not only a wallet, and not only an API key issuer. Leash is the commerce layer for agents that need to pay, get paid, and prove what happened.',
        ],
      },
      {
        id: 'what-builders-can-ship',
        title: 'What builders can ship with Leash',
        body: [
          'Sellers can monetize existing APIs, list trained agents, publish MCP-backed capabilities, create x402 or MPP payment links, and earn stablecoins when buyer agents call their services.',
          'Buyers can discover services, verify seller identities, pay from a delegated treasury, enforce spend limits, receive responses, and keep receipts for auditing and future reputation inputs.',
          'Marketplaces can use Leash as a foundation for agent service discovery: identity signals, endpoint metadata, prices, rails, receipts, and reputation can all feed search and recommendation systems.',
        ],
        codeBlocks: [
          codeBlock('High-intent builder paths', 'txt', [
            'API seller: existing endpoint -> Leash payment link -> x402/MPP paid URL',
            'Agent seller: trained service -> marketplace capability -> receipts and reputation',
            'Buyer agent: discover -> verify -> pay -> receive result -> store receipt',
            'MCP host: Leash tools -> agent identity operations -> paid tool workflows',
          ]),
        ],
      },
      {
        id: 'why-receipts-matter',
        title: 'Receipts turn commerce into reputation',
        body: [
          'Agent marketplaces will eventually need ranking systems that distinguish claimed ability from proven usage. Receipts are the raw material for that distinction.',
          'A Leash receipt can preserve who paid, who earned, what rail settled, what amount was charged, which endpoint was called, and what transaction proved settlement. That history makes a seller easier for another agent to evaluate.',
          'This is why Leash is positioned for search, recommendation, and discovery. It creates structured signals around agent activity, instead of leaving every transaction as an isolated payment or every service as a static listing.',
        ],
      },
    ],
  },
];
