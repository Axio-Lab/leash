import { codeBlock, docs, type BlogArticle } from './helpers';

const publishedAt = '2026-06-04';

export const articlesGenerated20260604: BlogArticle[] = [
  {
    slug: 'native-solana-subscriptions-for-ai-agent-services',
    title: 'Native Solana subscriptions for AI agent services',
    seoTitle:
      'Native Solana subscriptions for AI agents: recurring payments, allowances, and Leash',
    seoDescription:
      'Leash now supports native Solana Subscriptions and Allowances so AI agents can create recurring service plans, invoices, retainers, delegated spend, and subscription-based agent capabilities.',
    eyebrow: 'Native subscriptions',
    description:
      'Leash adds native Solana Subscriptions and Allowances to its Know Your Agent infrastructure, giving agent services a recurring payment rail for plans, invoices, retainers, and delegated spend.',
    category: 'Agent infrastructure',
    audience:
      'AI agent founders, MCP tool builders, agent service sellers, marketplace operators, Solana developers, and teams building recurring billing for autonomous software',
    publishedAt,
    readingMinutes: 10,
    keywords: [
      'native Solana subscriptions',
      'AI agent subscriptions',
      'recurring payments for AI agents',
      'Solana allowances',
      'agent recurring billing',
      'AI agent invoices',
      'subscription payment rail',
      'agent-to-agent recurring payments',
      'Leash native subscriptions',
      'Solana subscription plan',
    ],
    tags: [
      'Solana',
      'Subscriptions',
      'Allowances',
      'Agent payments',
      'Recurring billing',
      'MCP',
      'CLI',
      'SDK',
    ],
    takeaways: [
      'Leash now wraps Solana native Subscriptions and Allowances with agent identity, SDK, CLI, MCP, API, UI, docs, events, and Explorer visibility.',
      'Agent sellers can create recurring service plans for reports, monitoring, support, data feeds, APIs, and retainers.',
      'Buyer agents and wallets can approve native subscriptions or allowances instead of approving every repeated payment manually.',
      'Existing x402 and MPP payment links still use Leash delegated SPL settlement; native subscriptions are additive for recurring plans and allowance-based services.',
      'The first implementation supports authority setup, fixed allowances, recurring allowances, plans, subscription lifecycle actions, and collection flows.',
    ],
    docsLinks: [
      docs('/guides/native-subscriptions', 'Native subscriptions guide'),
      docs('/agents/cli', 'Leash CLI'),
      docs('/agents/sdk', 'Leash SDK'),
      docs('/agents/mcp', 'Leash MCP server'),
      docs('/concepts/identities', 'Agent identities'),
    ],
    relatedArticles: [
      'what-is-an-agent-payment-rail',
      'spend-limits-for-autonomous-agents',
      'what-is-agent-to-agent-commerce',
      'stablecoin-payments-for-ai-agents',
      'mcp-payments-for-ai-agents',
    ],
    cta: {
      label: 'Read the native subscriptions guide',
      href: 'https://docs.leash.market/guides/native-subscriptions',
    },
    faqs: [
      {
        question: 'What are native Solana subscriptions for AI agents?',
        answer:
          'Native Solana subscriptions let a wallet or agent approve a recurring payment relationship on-chain. Leash adds the agent identity, capability metadata, CLI, SDK, MCP, API, events, and documentation around that native program so agent services can sell recurring work.',
      },
      {
        question: 'Does this replace Leash x402 and MPP payment links?',
        answer:
          'No. Native subscriptions are additive. Existing x402 and MPP payment links still use the Leash SPL delegation rail for paid endpoint calls, while native subscriptions handle recurring plans, recurring invoices, allowances, and scheduled collection flows.',
      },
      {
        question: 'What can an agent sell with native subscriptions?',
        answer:
          'Agents can sell monthly reports, monitoring plans, research retainers, customer-support seats, data feeds, compliance checks, usage allowances, recurring invoices, and agent-to-agent service contracts.',
      },
      {
        question: 'Can MCP agents use the new subscription rail?',
        answer:
          'Yes. The standalone Leash MCP server exposes the `leash_native_subscriptions` tool so an agent runtime can initialize authority, create plans, create allowances, subscribe, cancel, resume, revoke, and collect with the configured wallet.',
      },
    ],
    sections: [
      {
        id: 'why-recurring-agent-payments-matter',
        title: 'Why recurring payments matter for AI agents',
        body: [
          'One-off paid API calls are only part of agent commerce. Many useful agent services are recurring by nature: weekly reports, monthly monitoring, ongoing lead enrichment, retained research, incident response, support automation, compliance checks, and market data access.',
          'Before native subscriptions, a buyer agent either had to pay every call through a normal endpoint rail or a human had to manage recurring billing somewhere outside the agent identity. That creates a split: the agent can call the service, but the recurring commercial relationship lives somewhere else.',
          'Native Solana Subscriptions and Allowances give that relationship an on-chain shape. Leash then makes it agent-native by connecting the rail to Know Your Agent identity, capability cards, SDK calls, MCP tools, CLI commands, events, Explorer views, and docs.',
        ],
      },
      {
        id: 'how-it-works',
        title: 'How Leash native subscriptions work',
        body: [
          'A merchant agent creates a subscription authority for a stablecoin mint, then creates a plan with an amount, period, destinations, pullers, and metadata. Another wallet or agent subscribes to the plan. Later, the merchant or approved puller collects according to the rules enforced by the native Solana program.',
          'Allowances are similar but simpler. A wallet can create a fixed allowance for one capped amount or a recurring allowance for a capped amount per period. The delegatee can pull within that authorization, and the owner can revoke it.',
          'The Leash implementation exposes this through the API, SDK, CLI, MCP, and the agents UI. It also records native subscription and allowance events so the Explorer and webhook surfaces can show that an agent service is not only payable, but recurring-payment ready.',
        ],
        codeBlocks: [
          codeBlock('Native subscription flow', 'txt', [
            '1. Merchant initializes native subscription authority',
            '2. Merchant creates a subscription plan',
            '3. Subscriber approves the plan',
            '4. Merchant or approved puller collects when the period allows',
            '5. Events and receipts connect the action back to the agent identity',
          ]),
        ],
      },
      {
        id: 'developer-surfaces',
        title: 'Developer surfaces: CLI, SDK, MCP, API, and UI',
        body: [
          'The CLI is the fastest path for operators. It can initialize authority, create plans, create fixed allowances, create recurring allowances, transfer from allowances, subscribe, cancel, resume, revoke, and collect.',
          'The SDK exposes typed prepare methods for app developers who want a browser wallet, HSM, KMS, or custom signer to own the final signature. The API returns unsigned prepared transactions for the same native actions.',
          'The MCP server gives autonomous runtimes a direct tool named `leash_native_subscriptions`. The agents UI adds a browser-signed native recurring services panel so a human can create a demo plan quickly from Profile Spend.',
        ],
        codeBlocks: [
          codeBlock('CLI: create a monthly plan', 'bash', [
            'leash subscriptions authority-create --token USDC',
            'leash subscriptions plan-create \\',
            '  --plan-id 1001 \\',
            '  --amount 10 \\',
            '  --period-hours 720 \\',
            '  --metadata-uri https://example.com/plans/monthly-report.json',
          ]),
          codeBlock('MCP: create a plan', 'json', [
            '{',
            '  "action": "plan_create",',
            '  "symbol": "USDC",',
            '  "plan_id": "1001",',
            '  "amount": 10,',
            '  "period_hours": 720',
            '}',
          ]),
          codeBlock('SDK: prepare a plan transaction', 'ts', [
            'const prepared = await leash.prepareNativeSubscriptionPlan(agentMint, {',
            '  payer,',
            '  spl_mint: usdcMint,',
            "  plan_id: '1001',",
            "  amount: '10000000',",
            "  period_hours: '720',",
            "  metadata_uri: 'https://example.com/plans/monthly-report.json',",
            '});',
          ]),
        ],
      },
      {
        id: 'use-cases',
        title: 'Use cases for recurring agent services',
        body: [
          'Monitoring agents can sell weekly uptime reports, incident summaries, security alerts, or SLA tracking. Data agents can sell recurring access to enrichment, market feeds, research summaries, or analytics exports.',
          'Operations agents can sell monthly bookkeeping support, compliance scans, invoice reconciliation, creator analytics, customer support, or recurring workflow automation. Specialist agents can sell retainers where a buyer pays a predictable amount per period for access.',
          'Marketplaces can use native subscription readiness as a ranking and filtering signal. A listed service can advertise that it supports one-off x402/MPP calls and recurring native subscription plans, which makes the service easier for other agents to evaluate and buy.',
        ],
        codeBlocks: [
          codeBlock('High-intent recurring products', 'txt', [
            'Research agent: 25 USDC/week for a market intelligence memo',
            'Monitoring agent: 10 USDC/month for uptime and incident reports',
            'Compliance agent: 50 USDC/month for vendor risk checks',
            'Data agent: 5 USDC/day for refreshed enrichment results',
            'Support agent: 100 USDC/month for customer-response automation',
          ]),
        ],
      },
      {
        id: 'current-rail-boundaries',
        title: 'Current rail boundaries',
        body: [
          'Native subscriptions are not a replacement for every Leash payment path. They are the recurring authorization rail. Existing Leash x402 and MPP payment links remain the best path for per-call paid HTTP endpoints and agent-to-agent service calls.',
          'In the current implementation, standalone CLI and MCP can sign native actions with the configured executive wallet. Browser flows use wallet signing from the agents UI. The native authority belongs to the signing wallet token account; agent treasury settlement for x402 and MPP continues to use the existing SPL delegation model.',
          'This boundary is useful. It keeps existing paid endpoint integrations stable while adding a new recurring service primitive for agents that want subscriptions, invoices, retainers, and allowance-based access.',
        ],
      },
    ],
  },
];
