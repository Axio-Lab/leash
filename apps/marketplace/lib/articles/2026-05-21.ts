import {
  codeBlock,
  docs,
  makeGuideArticle,
  type BlogArticle,
  type ProgrammaticArticleSpec,
} from './helpers';

const existingIdentityArticle: BlogArticle = {
  slug: 'identity-layer-for-ai-agents',
  title: 'What is an identity layer for AI agents?',
  seoTitle: 'What is an identity layer for AI agents? | Leash',
  seoDescription:
    'Learn why AI agents need portable identity, treasury, policy, capabilities, receipts, and reputation instead of disconnected wallets and API keys.',
  eyebrow: 'Agent identity',
  description:
    'AI agents need more than wallets and API keys. They need portable identity, policy, capabilities, receipts, and reputation that follow them across the internet.',
  category: 'Identity layer',
  audience: 'AI agent builders, protocol teams, and marketplace operators',
  publishedAt: '2026-05-21',
  readingMinutes: 5,
  keywords: [
    'AI agent identity layer',
    'agent identity',
    'onchain agent identity',
    'AI agent reputation',
    'Leash',
  ],
  tags: ['Agent identity', 'Capabilities', 'x402', 'Reputation'],
  takeaways: [
    'Agent identity should be a primitive, not a profile page.',
    'Capabilities become safer when they are tied to policy and receipts.',
    'Reputation should come from verifiable behavior, not self-reported claims.',
  ],
  faqs: [
    {
      question: 'Is Leash only a payment system?',
      answer:
        'No. Payments are one surface of the identity layer. Leash ties payments to agent identity, policy, capabilities, receipts, and reputation.',
    },
    {
      question: 'What is the stable anchor for a Leash identity?',
      answer:
        'The stable anchor is the agent mint. Registration metadata, treasury, policy, events, and receipts all connect back to that mint.',
    },
  ],
  docsLinks: [
    docs('/introduction', 'Leash introduction'),
    docs('/concepts/agent', 'Agent concept'),
    docs('/api/identity', 'Identity API'),
  ],
  relatedArticles: [
    'how-to-create-ai-agent-identity-solana',
    'capability-cards-for-ai-agents',
    'how-receipts-become-ai-agent-reputation',
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
};

const programmaticArticleSpecs: ProgrammaticArticleSpec[] = [
  {
    slug: 'how-to-create-ai-agent-identity-solana',
    title: 'How to create an AI agent identity on Solana with Leash',
    eyebrow: 'Create identity',
    category: 'Identity layer',
    audience: 'Builders creating a first Leash agent',
    description:
      'Create a portable AI agent identity on Solana with an agent mint, registration metadata, treasury, executive key, and services.',
    keywords: ['create AI agent identity', 'Solana AI agent', 'Leash agent create'],
    tags: ['Agent identity', 'Solana', 'CLI', 'MCP'],
    takeaways: [
      'The agent mint is the identity anchor.',
      'The executive key lets the agent operate without exposing the owner wallet.',
      'Services and metadata make the identity discoverable.',
    ],
    useCase:
      'When you create an AI agent identity, you are giving software a stable public handle that can receive funds, advertise services, operate with delegated authority, and accumulate reputation.',
    mechanics:
      'Leash creates an MPL Core agent asset, records registration metadata, derives the treasury, and stores the local agent configuration used by the CLI and MCP server.',
    checklist:
      'Pick a name and description, decide whether to generate or import the executive key, add service endpoints, fund the printed executive pubkey, then rerun the create command to finish minting and recording.',
    codeBlocks: [
      codeBlock('Create an agent with the CLI', 'bash', [
        'leash agent create \\',
        '  --name "Research Agent" \\',
        '  --description "Autonomous research assistant with paid API access." \\',
        '  --service web=https://agent.example \\',
        '  --service api=https://api.agent.example',
        '',
        '# Fund the printed executive pubkey, then resume.',
        'leash agent create',
        'leash agent show',
      ]),
    ],
    faqs: [
      {
        question: 'Can I bring my own executive key?',
        answer:
          'Yes. The CLI and MCP support importing an existing ed25519 executive key instead of generating a new one.',
      },
      {
        question: 'Does the agent identity work outside the web app?',
        answer:
          'Yes. The same agent.json can be used by the CLI, MCP server, and local automation runtimes.',
      },
    ],
    docsLinks: [
      docs('/guides/create-an-agent', 'Create an agent'),
      docs('/agents/cli', 'CLI guide'),
    ],
    relatedArticles: [
      'what-is-agent-treasury',
      'how-to-mint-verify-pay-leash-cli',
      'how-to-give-ai-agent-leash-tools-through-mcp',
    ],
  },
  {
    slug: 'what-is-agent-treasury',
    title: 'What is an agent treasury?',
    eyebrow: 'Treasury',
    category: 'Identity layer',
    audience: 'Founders and engineers designing agent wallets',
    description:
      'An agent treasury is the onchain account where an AI agent receives, spends, and proves value under its identity.',
    keywords: ['agent treasury', 'AI agent wallet', 'Solana treasury PDA'],
    tags: ['Treasury', 'Solana', 'USDC', 'Identity'],
    takeaways: [
      'Funds belong to the agent identity, not a random hot wallet.',
      'Treasury balances and delegation are inspectable.',
      'Receipts connect spend and earn activity back to the identity.',
    ],
    useCase:
      'Agent builders need a way to fund software without turning every task into a manual wallet approval. The treasury gives the agent a stable place to hold SOL and stablecoins.',
    mechanics:
      'Leash derives an Asset Signer PDA treasury for the agent mint and lets an executive key spend approved SPL token amounts from that treasury.',
    checklist:
      'After minting an agent, check balances, create stable token accounts when needed, fund the treasury, and set a delegation cap that matches the job size.',
    codeBlocks: [
      codeBlock('Inspect treasury balances', 'bash', [
        'leash treasury balance',
        'leash treasury limit --token USDC',
        'leash treasury set-limit --token USDC --amount 25',
      ]),
    ],
    faqs: [
      {
        question: 'Is an agent treasury a normal wallet?',
        answer:
          'It is derived from the agent identity. The treasury can receive funds, but spending is controlled through delegated authority and policy.',
      },
      {
        question: 'Which tokens does Leash track by default?',
        answer:
          'Leash tracks SOL and stablecoins such as USDC, USDT, and USDG where supported by the configured network.',
      },
    ],
    docsLinks: [
      docs('/concepts/treasury', 'Treasury concept'),
      docs('/api/treasury', 'Treasury API'),
    ],
    relatedArticles: [
      'how-to-fund-ai-agent-set-spend-limits',
      'how-leash-policy-keeps-ai-agents-inside-limits',
      'how-receipts-become-ai-agent-reputation',
    ],
  },
  {
    slug: 'how-leash-policy-keeps-ai-agents-inside-limits',
    title: 'How Leash policy keeps AI agents inside spend and host limits',
    eyebrow: 'Policy',
    category: 'Identity layer',
    audience: 'Teams giving agents budgeted autonomy',
    description:
      'Leash policy lets AI agents act with budget, host, trigger, and stop-condition limits that are visible on the identity.',
    keywords: ['AI agent policy', 'agent spend limits', 'RulesV1'],
    tags: ['Policy', 'RulesV1', 'Spend limits', 'Security'],
    takeaways: [
      'Policy is part of the identity, not a hidden app setting.',
      'Rules can constrain spend, hosts, triggers, and stop conditions.',
      'Denied actions can still produce useful proof trails.',
    ],
    useCase:
      'Autonomous agents need more than a balance. They need explicit rules for where they can spend, how much they can spend, and when they should stop.',
    mechanics:
      'Leash represents these rules with typed policy documents such as RulesV1 and evaluates them before buyer calls, automation runs, and payment flows.',
    checklist:
      'Define the daily and per-call budget, allow only the hosts your agent needs, keep trigger scope tight, and review receipts for denied or warned actions.',
    codeBlocks: [
      codeBlock('RulesV1 budget and host policy', 'json', [
        '{',
        '  "v": "0.1",',
        '  "budget": { "daily": "10", "perCall": "0.25", "currency": "USDC" },',
        '  "hosts": { "allow": ["api.example.com"] },',
        '  "triggers": [{ "type": "interval", "seconds": 3600 }]',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Can policy block a payment before settlement?',
        answer:
          'Yes. Buyer-side policy can deny a call before the agent signs or settles the payment.',
      },
      {
        question: 'Is policy only for payments?',
        answer:
          'No. Policy also describes allowed triggers, hosts, and operating boundaries for broader agent behavior.',
      },
    ],
    docsLinks: [
      docs('/concepts/policy', 'Policy concept'),
      docs('/schemas/rules-v1', 'RulesV1 schema'),
    ],
    relatedArticles: [
      'what-is-agent-treasury',
      'how-to-build-autonomous-buyer-leashmarket-buyer-kit',
      'how-to-fund-ai-agent-set-spend-limits',
    ],
  },
  {
    slug: 'capability-cards-for-ai-agents',
    title: 'Capability cards for AI agents',
    eyebrow: 'Capabilities',
    category: 'Identity layer',
    audience: 'Marketplace builders and agent operators',
    description:
      'Capability cards describe what an AI agent identity can sell, call, connect, automate, or expose to other agents.',
    keywords: ['AI agent capability cards', 'agent capabilities', 'Leash marketplace'],
    tags: ['Capabilities', 'Marketplace', 'Identity', 'Discovery'],
    takeaways: [
      'Capabilities are attached to identities.',
      'Cards can represent seller APIs, buyer tools, data sources, control channels, automations, and marketplace listings.',
      'Visibility controls decide what appears publicly.',
    ],
    useCase:
      'A useful agent profile should answer what the agent can actually do. Capability cards turn services, tools, and integrations into discoverable identity metadata.',
    mechanics:
      'Leash stores capability cards on the identity profile and exposes public cards through explorer and marketplace views while keeping private cards owner-only.',
    checklist:
      'Attach cards for sellable APIs, tools the agent can call, connector channels, automations, and pay.sh capabilities the agent has pinned.',
    codeBlocks: [
      codeBlock('Capability card shape', 'json', [
        '{',
        '  "kind": "seller_api",',
        '  "title": "Premium Search API",',
        '  "source": "leash",',
        '  "slug": "premium-search",',
        '  "protocols": ["x402"],',
        '  "visibility": "public"',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Are pay.sh providers also capabilities?',
        answer:
          'Yes. Leash treats pay.sh/pay-skills providers as external capabilities that an agent identity can discover and pin.',
      },
      {
        question: 'Can a capability be private?',
        answer:
          'Yes. Private cards remain available to the owner and do not appear in public marketplace or explorer views.',
      },
    ],
    docsLinks: [
      docs('/concepts/capabilities', 'Capabilities concept'),
      docs('/api/identity#capability-cards', 'Capability cards API'),
    ],
    relatedArticles: [
      'how-to-discover-ai-agent-capabilities-leash-market',
      'how-to-list-identity-backed-marketplace-capability',
      'what-pay-sh-capabilities-mean-inside-leash',
    ],
  },
  {
    slug: 'verified-domains-handles-claims-agent-identity',
    title: 'Verified domains, handles, and claims for agent identity',
    eyebrow: 'Identity metadata',
    category: 'Identity layer',
    audience: 'Teams building public agent profiles',
    description:
      'Use handles, verified domains, and signed claims to make an AI agent identity easier to resolve and safer to trust.',
    keywords: ['agent verified domain', 'AI agent handle', 'agent claims'],
    tags: ['Verified domains', 'Claims', 'Handles', 'Identity'],
    takeaways: [
      'Handles make agent identities human-readable.',
      'Verified domains bind web ownership to an agent mint.',
      'Claims let issuers attach attestations with revocation state.',
    ],
    useCase:
      'A raw mint is stable, but humans and agents often need a friendlier selector. Handles, domains, and claims add context without replacing the canonical mint.',
    mechanics:
      'Leash resolves identity selectors to the same public profile and verifies domains with a .well-known/leash-agent.json file that names the mint and network.',
    checklist:
      'Choose a handle, host the well-known file on your domain, verify it through the Identity API, then attach public claims only when the issuer and evidence are meaningful.',
    codeBlocks: [
      codeBlock('Well-known domain file', 'json', [
        '{',
        '  "mint": "Agnt...",',
        '  "network": "solana-devnet"',
        '}',
      ]),
      codeBlock('Resolve a verified domain', 'bash', [
        "curl 'https://api.leash.market/v1/identity/resolve?domain=agent.example'",
      ]),
    ],
    faqs: [
      {
        question: 'Does a handle replace the mint?',
        answer: 'No. A handle is a resolver. The mint remains the canonical identity anchor.',
      },
      {
        question: 'Can claims expire or be revoked?',
        answer:
          'Yes. Claims include expiration and revocation fields so consumers can filter stale attestations.',
      },
    ],
    docsLinks: [
      docs('/api/identity#verified-domains', 'Verified domains'),
      docs('/api/identity#claims-and-attestations', 'Claims'),
    ],
    relatedArticles: [
      'agent-to-agent-verification-before-paying-api',
      'selective-disclosure-private-ai-agent-data',
      'operator-history-delegation-ai-agents',
    ],
  },
  {
    slug: 'selective-disclosure-private-ai-agent-data',
    title: 'Selective disclosure for private AI agent data',
    eyebrow: 'Privacy',
    category: 'Identity layer',
    audience: 'Teams sharing private proofs with partners',
    description:
      'Selective disclosure lets an agent owner share private capability cards, private claims, or selected receipts without making them public.',
    keywords: ['selective disclosure AI agents', 'private agent claims', 'private receipts'],
    tags: ['Selective disclosure', 'Privacy', 'Claims', 'Receipts'],
    takeaways: [
      'Public identity pages stay public-only by default.',
      'Disclosure links reveal only the selected resources.',
      'Grants can expire or be revoked.',
    ],
    useCase:
      'Some agent identity data is useful for due diligence but should not be indexed publicly. Selective disclosure gives partners a temporary, scoped view.',
    mechanics:
      'Leash stores disclosure grants with resource lists, expiry, revocation state, and bearer-token access to the selected private identity resources.',
    checklist:
      'Choose the exact resources, use the shortest practical expiry, share the token with the verifier, and revoke it when the review is finished.',
    codeBlocks: [
      codeBlock('Read a disclosure with the SDK', 'ts', [
        "import { LeashClient } from '@leashmarket/sdk';",
        '',
        "const leash = new LeashClient({ baseUrl: 'https://api.leash.market' });",
        "const disclosed = await leash.readIdentityDisclosure('lsh_disclosure_token');",
        'console.log(disclosed.resources.capability_cards);',
      ]),
    ],
    faqs: [
      {
        question: 'Is selective disclosure zero-knowledge privacy?',
        answer:
          'No. Product V1 uses scoped, revocable disclosure links. It is not a ZK proof system.',
      },
      {
        question: 'Can a disclosure expose unrelated private data?',
        answer: 'No. The public endpoint should return only the resources included in the grant.',
      },
    ],
    docsLinks: [
      docs('/api/identity#selective-disclosure', 'Selective disclosure'),
      docs('/schemas/identity-disclosure-v1', 'Identity Disclosure V1'),
    ],
    relatedArticles: [
      'verified-domains-handles-claims-agent-identity',
      'agent-to-agent-verification-before-paying-api',
      'how-receipts-become-ai-agent-reputation',
    ],
  },
  {
    slug: 'agent-to-agent-verification-before-paying-api',
    title: 'Agent-to-agent verification before paying an API',
    eyebrow: 'Trust verdicts',
    category: 'Identity layer',
    audience: 'Autonomous buyer and marketplace developers',
    description:
      'Ask Leash for an allow, warn, or deny decision before an AI agent pays another agent or calls a paid capability.',
    keywords: ['agent-to-agent verification', 'verify seller identity', 'AI agent trust verdict'],
    tags: ['Verification', 'SDK', 'Buyer kit', 'Reputation'],
    takeaways: [
      'Verification resolves mint, handle, or domain selectors.',
      'Trust decisions can include reputation, claims, domains, and capability matching.',
      'Buyer agents can block payment on deny verdicts.',
    ],
    useCase:
      'Before an autonomous buyer pays a seller API, it should know whether the seller identity resolves, matches the capability, and passes the buyer policy threshold.',
    mechanics:
      'Leash exposes a simple verify endpoint for compatibility and a decision endpoint for automated trust checks with intent, capability, and threshold inputs.',
    checklist:
      'Resolve the seller, request a decision for the intended action, inspect the structured checks, and only settle the payment when the verdict matches your risk policy.',
    codeBlocks: [
      codeBlock('Verify before paying with the SDK', 'ts', [
        "import { LeashClient } from '@leashmarket/sdk';",
        '',
        'const leash = new LeashClient();',
        'const decision = await leash.verifyIdentityDecision({',
        "  selector: { handle: 'seller-agent' },",
        "  intent: 'pay',",
        "  capability: { slug: 'seller/tag-api', protocol: 'x402' },",
        '  thresholds: { min_rating: 0.2, require_verified_domain: true },',
        '});',
        '',
        "if (decision.verdict === 'deny') throw new Error('Seller did not verify');",
      ]),
    ],
    faqs: [
      {
        question: 'What is the difference between verify and a trust decision?',
        answer:
          'Verify checks that a selector resolves to a live identity. A trust decision evaluates an intended interaction and returns allow, warn, or deny.',
      },
      {
        question: 'Can buyer-kit use this automatically?',
        answer:
          'Yes. buyer-kit can run an identity preflight before settlement when seller identity metadata is available.',
      },
    ],
    docsLinks: [
      docs('/api/identity#verify-before-trusting', 'Verify before trusting'),
      docs('/agents/sdk', 'SDK guide'),
    ],
    relatedArticles: [
      'how-to-verify-seller-identity-leashmarket-sdk',
      'how-to-build-autonomous-buyer-leashmarket-buyer-kit',
      'how-receipts-become-ai-agent-reputation',
    ],
  },
  {
    slug: 'operator-history-delegation-ai-agents',
    title: 'Operator history and delegation for AI agents',
    eyebrow: 'Delegation',
    category: 'Identity layer',
    audience: 'Teams operating agents with delegated keys',
    description:
      'Operator history records executive and delegation changes so an agent identity has an audit trail for who could act and when.',
    keywords: ['AI agent delegation', 'operator history', 'executive key'],
    tags: ['Delegation', 'Operator history', 'Audit trail', 'Identity'],
    takeaways: [
      'Delegation lets agents operate without owner-key custody.',
      'Operator history makes authority changes inspectable.',
      'Confirmed public events can appear on explorer identity pages.',
    ],
    useCase:
      'Production agents need key rotation, delegated operators, and spend authority changes. Those events should not disappear into logs.',
    mechanics:
      'Leash normalizes executive registration, SPL delegation, revoke, and related events into an identity timeline with phase and transaction metadata when available.',
    checklist:
      'Record who owns the identity, who operates it, which token approvals exist, and whether each event was prepared, submitted, confirmed, or failed.',
    codeBlocks: [
      codeBlock('Inspect delegation from the CLI', 'bash', [
        'leash agent show',
        'leash treasury limit --token USDC',
        'leash treasury set-limit --token USDC --revoke',
      ]),
    ],
    faqs: [
      {
        question: 'Why split owner and executive roles?',
        answer:
          'The owner can keep custody while the executive operates online with limited delegated authority.',
      },
      {
        question: 'Does operator history expose private owner data?',
        answer:
          'Public views should show only public, confirmed operator and delegation events. Owner views can show more detail.',
      },
    ],
    docsLinks: [
      docs('/concepts/identities', 'Identity roles'),
      docs('/api/identity#operator-history', 'Operator history'),
    ],
    relatedArticles: [
      'how-to-create-ai-agent-identity-solana',
      'how-to-fund-ai-agent-set-spend-limits',
      'prepare-sign-submit-leash-transaction-lifecycle',
    ],
  },
  {
    slug: 'automate-ai-agent-whatsapp-telegram',
    title: 'How to automate an AI agent from WhatsApp or Telegram',
    eyebrow: 'Automations',
    category: 'Agents app',
    audience: 'Operators controlling agents from external chat',
    description:
      'Use WhatsApp or Telegram as control channels for creating, inspecting, pausing, enabling, and reviewing Leash automations.',
    keywords: ['AI agent WhatsApp automation', 'Telegram agent automation', 'Leash automations'],
    tags: ['Automations', 'WhatsApp', 'Telegram', 'Agents app'],
    takeaways: [
      'External chat can become a control channel capability.',
      'Automation create, edit, delete, and pause flows should require confirmation.',
      'Reports can return to the originating chat when configured.',
    ],
    useCase:
      'Users often want to manage an agent where they already talk to it. Connector-native automation makes WhatsApp and Telegram first-class control surfaces.',
    mechanics:
      'Leash routes external messages through the agent run endpoint, detects automation intent before normal chat fallback, and scopes pending confirmations to the owner and connection.',
    checklist:
      'Connect the external channel, ask the agent what to automate, review the drafted automation, confirm it, and inspect future status or latest results from the same chat.',
    codeBlocks: [
      codeBlock('Example external chat commands', 'text', [
        'Create an automation that checks my support inbox every morning and reports urgent items here.',
        'List my automations.',
        'Pause the inbox triage automation.',
        'Show the latest result from inbox triage.',
      ]),
    ],
    faqs: [
      {
        question: 'Can an external chat create an automation directly?',
        answer:
          'The agent can draft it from natural language, but create, edit, and delete actions should be saved only after confirmation.',
      },
      {
        question: 'Where do reports go?',
        answer:
          'Automations created from WhatsApp or Telegram can default to reporting back to that originating chat.',
      },
    ],
    docsLinks: [
      docs('/concepts/capabilities', 'Control channel capabilities'),
      docs('/api/identity', 'Identity API'),
    ],
    relatedArticles: [
      'connector-data-sources-power-leash-automations',
      'capability-cards-for-ai-agents',
      'how-leash-policy-keeps-ai-agents-inside-limits',
    ],
  },
  {
    slug: 'connector-data-sources-power-leash-automations',
    title: 'How connector data sources power Leash automations',
    eyebrow: 'Connectors',
    category: 'Agents app',
    audience: 'Teams wiring SaaS data into agent workflows',
    description:
      'Leash connectors let automations use external accounts as data sources and report destinations while staying attached to the same agent identity.',
    keywords: ['AI agent connectors', 'automation data sources', 'Leash connections'],
    tags: ['Connectors', 'Automations', 'Data sources', 'Reports'],
    takeaways: [
      'A connector can be a data source, a control channel, or a report destination.',
      'Connector-backed automations should record run history even if report delivery fails.',
      'Capability cards make connector use visible at the identity layer when appropriate.',
    ],
    useCase:
      'An automation is only useful if it can read the right data and report in the right place. Connectors provide that context without breaking the identity model.',
    mechanics:
      'Leash treats connected services as capabilities attached to the active agent. Automations can reference those connections and record delivery status separately from run success.',
    checklist:
      'Connect the account, choose whether it is a source or destination, describe the automation in natural language, and verify the report policy before enabling it.',
    codeBlocks: [
      codeBlock('Prompt a connector-backed automation', 'text', [
        'Use my Gmail connection as a source.',
        'Every weekday morning, summarize billing-related messages.',
        'Report only the summary in Telegram and keep full history in Leash.',
      ]),
    ],
    faqs: [
      {
        question: 'Does every automation need report delivery?',
        answer:
          'No. Some automations only need history. Others should report to chat, webhook, or another connected destination.',
      },
      {
        question: 'What happens when delivery fails?',
        answer:
          'The run should still land in history, with delivery status recording the failure for debugging.',
      },
    ],
    docsLinks: [
      docs('/concepts/capabilities', 'Capabilities concept'),
      docs('/api/webhooks', 'Webhooks'),
    ],
    relatedArticles: [
      'automate-ai-agent-whatsapp-telegram',
      'how-to-use-webhooks-agent-identity-events',
      'capability-cards-for-ai-agents',
    ],
  },
  {
    slug: 'what-is-x402-on-solana',
    title: 'What is x402 on Solana?',
    eyebrow: 'x402',
    category: 'Facilitator',
    audience: 'Developers monetizing APIs for agents',
    description:
      'x402 on Solana lets an API reply with payment requirements, settle an SPL stablecoin transfer, and retry the request with proof.',
    keywords: ['x402 Solana', 'AI agent payments', 'SPL x402'],
    tags: ['x402', 'Solana', 'Payments', 'Facilitator'],
    takeaways: [
      'The first request returns 402 Payment Required.',
      'The buyer signs a matching Solana payment.',
      'The settled response becomes part of the receipt trail.',
    ],
    useCase:
      'AI agents need to buy API calls without subscription setup. x402 turns HTTP 402 into a machine-readable payment round trip.',
    mechanics:
      'Leash uses x402 with the Exact SVM scheme so a buyer can sign an SPL transfer, settle through a facilitator, and retry the original HTTP request with payment proof.',
    checklist:
      'Expose a paid route, configure the seller payTo treasury, use a compatible facilitator, and record buyer or seller receipts after settlement.',
    codeBlocks: [
      codeBlock('Probe a paid x402 endpoint', 'bash', [
        "curl -i 'https://api.example.com/premium'",
        '',
        '# Expected first response:',
        '# HTTP/1.1 402 Payment Required',
        '# PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi...',
      ]),
    ],
    faqs: [
      {
        question: 'Does x402 require a browser checkout?',
        answer:
          'No. Agents can handle the 402 response, sign the Solana payment, and retry programmatically.',
      },
      {
        question: 'Where does the seller receive funds?',
        answer:
          'With Leash seller-kit, funds can land in the seller agent treasury PDA tied to the seller identity.',
      },
    ],
    docsLinks: [
      docs('/standards/x402-on-solana', 'Real x402 on Solana'),
      docs('/guides/build-a-seller', 'Build a seller'),
    ],
    relatedArticles: [
      'x402-vs-mpp-ai-agent-payments',
      'how-to-run-leash-facilitator',
      'how-to-build-paid-api-leashmarket-seller-kit',
    ],
  },
  {
    slug: 'x402-vs-mpp-ai-agent-payments',
    title: 'x402 vs MPP for AI agent payments',
    eyebrow: 'Payment protocols',
    category: 'Facilitator',
    audience: 'Teams choosing a paid API protocol',
    description:
      'Compare x402 and MPP for AI agent payments and learn how Leash supports both while preserving receipt and identity semantics.',
    keywords: ['x402 vs MPP', 'agent payment protocols', 'MPP Solana'],
    tags: ['x402', 'MPP', 'Payments', 'Receipts'],
    takeaways: [
      'x402 uses HTTP 402 payment-required semantics.',
      'MPP uses application/problem+json payment negotiation.',
      'Leash keeps both protocols attached to receipts and identities.',
    ],
    useCase:
      'Different paid APIs may speak different payment protocols. Buyers need a consistent way to discover, pay, and verify outcomes.',
    mechanics:
      'Leash probes the paid resource, detects whether it speaks x402 or MPP, settles with a compatible facilitator, and records protocol-aware receipt metadata.',
    checklist:
      'Pick x402 for HTTP 402 paywalls, MPP where problem+json negotiation is preferred, and keep buyer policy and receipt verification the same across both.',
    codeBlocks: [
      codeBlock('Create either kind of payment link', 'bash', [
        'leash pay https://api.example.com/x402-link',
        'leash pay https://api.example.com/mpp-link',
        '',
        '# Hosted links can be created with protocol x402 or mpp.',
      ]),
    ],
    faqs: [
      {
        question: 'Should sellers support both x402 and MPP?',
        answer:
          'Not always. Support the protocol your buyers expect, but keep receipts and identity verification consistent.',
      },
      {
        question: 'Can Leash discover both protocol types?',
        answer:
          'Yes. Discovery and payment flows can surface protocol metadata so agents know how to call a capability.',
      },
    ],
    docsLinks: [
      docs('/standards/x402-on-solana', 'x402 on Solana'),
      docs('/standards/mpp-on-solana', 'MPP on Solana'),
    ],
    relatedArticles: [
      'what-is-x402-on-solana',
      'how-to-run-leash-facilitator',
      'how-to-build-autonomous-buyer-leashmarket-buyer-kit',
    ],
  },
  {
    slug: 'how-to-run-leash-facilitator',
    title: 'How to run a Leash facilitator',
    eyebrow: 'Facilitator',
    category: 'Facilitator',
    audience: 'Infrastructure teams self-hosting x402 settlement',
    description:
      'Run a Leash-compatible facilitator for x402 settlement on Solana, including fee-payer setup and local verification.',
    keywords: ['run Leash facilitator', 'x402 facilitator', 'Solana facilitator'],
    tags: ['Facilitator', 'x402', 'Devnet', 'Self-hosting'],
    takeaways: [
      'A facilitator verifies and settles payment payloads.',
      'Use a dedicated fee payer, separate from buyer transfer authority.',
      'Smoke tests should produce a real devnet transaction signature.',
    ],
    useCase:
      'Self-hosting a facilitator gives you control over the settlement endpoint used by buyer-kit, seller-kit, and local tests.',
    mechanics:
      'The facilitator app wraps the facilitator package, exposes /verify, /settle, /supported, and /health, and registers the Exact SVM scheme for supported networks.',
    checklist:
      'Generate a dedicated keypair, fund it, export the secret, boot the app, confirm /supported, and point demos or tests at the local URL.',
    codeBlocks: [
      codeBlock('Run the facilitator locally', 'bash', [
        'solana-keygen new -o .leash-fee-payer.json --no-bip39-passphrase',
        'solana airdrop 1 -k .leash-fee-payer.json --url https://api.devnet.solana.com',
        'export LEASH_FACILITATOR_SECRET_KEY="$(cat .leash-fee-payer.json)"',
        'pnpm --filter @leashmarket/facilitator-app dev',
      ]),
    ],
    faqs: [
      {
        question: 'Can the fee payer be the same key as the buyer?',
        answer:
          'No. The x402 SVM scheme rejects settlements where the fee payer is also the transfer authority.',
      },
      {
        question: 'Which endpoint confirms protocol support?',
        answer:
          'Call /supported on the facilitator to see which schemes and networks are registered.',
      },
    ],
    docsLinks: [
      docs('/guides/run-a-facilitator', 'Run a facilitator'),
      docs('/api/protocol-fee', 'Protocol fee'),
    ],
    relatedArticles: [
      'common-x402-facilitator-setup-mistakes',
      'what-is-x402-on-solana',
      'how-to-test-agent-payments-playground',
    ],
  },
  {
    slug: 'common-x402-facilitator-setup-mistakes',
    title: 'Common x402 facilitator setup mistakes',
    eyebrow: 'Troubleshooting',
    category: 'Facilitator',
    audience: 'Developers debugging local x402 settlement',
    description:
      'Avoid the common setup issues that break x402 settlement, including wrong fee-payer keys, unfunded accounts, and mismatched network configuration.',
    keywords: ['x402 facilitator errors', 'invalid exact svm payload', 'facilitator setup'],
    tags: ['Facilitator', 'Troubleshooting', 'x402', 'Devnet'],
    takeaways: [
      'Use a dedicated fee payer keypair.',
      'Fund the fee payer on the same network you settle on.',
      'Keep buyer, seller, facilitator, and RPC network settings aligned.',
    ],
    useCase:
      'Most local facilitator failures are configuration issues rather than protocol bugs. A short checklist can save hours.',
    mechanics:
      'Leash settlement depends on consistent network, asset, facilitator URL, fee payer, buyer signer, and seller payTo configuration.',
    checklist:
      'Check the facilitator logs, verify /supported, confirm the fee payer balance, and run the API smoke test against your local facilitator URL.',
    codeBlocks: [
      codeBlock('Smoke-test a local facilitator', 'bash', [
        'export LEASH_FACILITATOR_URL=http://localhost:8787',
        'pnpm --filter @leashmarket/api facilitator:smoke',
        '',
        '# For full stack e2e:',
        'LEASH_API_FACILITATOR_URL=http://localhost:8787 pnpm --filter @leashmarket/api e2e:devnet',
      ]),
    ],
    faqs: [
      {
        question: 'What does invalid fee payer transferring funds mean?',
        answer:
          'It usually means the facilitator fee payer is also the buyer transfer authority. Use a separate keypair.',
      },
      {
        question: 'Why does devnet settlement fail after a restart?',
        answer:
          'The fee payer may be unfunded, the env secret may be missing, or the buyer and facilitator may be pointed at different networks.',
      },
    ],
    docsLinks: [
      docs('/guides/run-a-facilitator', 'Facilitator guide'),
      docs('/standards/x402-on-solana', 'x402 standard'),
    ],
    relatedArticles: [
      'how-to-run-leash-facilitator',
      'what-is-x402-on-solana',
      'how-to-use-leash-playground',
    ],
  },
  {
    slug: 'how-to-build-paid-api-leashmarket-seller-kit',
    title: 'How to build a paid API with @leashmarket/seller-kit',
    eyebrow: 'Seller kit',
    category: 'Packages',
    audience: 'API developers monetizing endpoints for agents',
    description:
      'Use @leashmarket/seller-kit to wrap Hono routes with x402 payment middleware, seller identity metadata, and earn receipts.',
    keywords: ['@leashmarket/seller-kit', 'paid API for AI agents', 'x402 seller'],
    tags: ['Seller kit', 'x402', 'Paid API', 'Receipts'],
    takeaways: [
      'seller-kit protects routes with real x402 middleware.',
      'Funds can land in the seller agent treasury.',
      'Settled calls emit earn receipts.',
    ],
    useCase:
      'If you already have an API, seller-kit gives it a paid agent-facing surface without inventing your own payment and receipt layer.',
    mechanics:
      'seller-kit mounts payment middleware, resolves the seller payTo address from the agent identity, and calls your receipt callback after a successful settled response.',
    checklist:
      'Create a seller agent identity, wrap the route, set prices, configure the facilitator, emit receipts, and publish seller identity metadata for buyers.',
    codeBlocks: [
      codeBlock('Create a paid Hono route', 'ts', [
        "import { createSeller } from '@leashmarket/seller-kit';",
        '',
        'createSeller(app, {',
        '  umi,',
        '  sellerAgent: { asset: assetMint },',
        "  routes: { 'POST /tag': { price: '$0.001', description: 'tag content' } },",
        '  onReceipt: (receipt) => fetch(`${RUNNER}/a/${receipt.agent}/receipts`, {',
        "    method: 'POST',",
        '    body: JSON.stringify(receipt),',
        '  }),',
        '});',
      ]),
    ],
    faqs: [
      {
        question: 'Does seller-kit emit receipts for failed post-payment handlers?',
        answer:
          'No. It should not record an earn receipt if the handler fails after payment, because that would misrepresent the trade.',
      },
      {
        question: 'Can seller-kit expose identity metadata?',
        answer:
          'Yes. Sellers can emit metadata that lets buyers verify the seller identity before paying.',
      },
    ],
    docsLinks: [
      docs('/sdk/seller-kit', 'seller-kit docs'),
      docs('/guides/build-a-seller', 'Build a seller'),
    ],
    relatedArticles: [
      'what-is-x402-on-solana',
      'how-to-verify-seller-identity-leashmarket-sdk',
      'how-to-list-identity-backed-marketplace-capability',
    ],
  },
  {
    slug: 'monetize-api-endpoint-with-leash-seller-kit',
    title: 'How to monetize an API endpoint with Leash seller-kit',
    seoTitle: 'Monetize an API endpoint with x402, MPP, and Leash seller-kit',
    seoDescription:
      'Turn an API route into a paid x402 or MPP endpoint using @leashmarket/seller-kit, hosted payment links, marketplace discovery, and explorer-ready receipts.',
    eyebrow: 'Endpoint monetization',
    category: 'Packages',
    audience: 'API builders selling capabilities to AI agents',
    description:
      'Wrap a normal API route with seller-kit, require stablecoin payment before the handler runs, and publish receipts so the transaction becomes reputation.',
    keywords: [
      'monetize API endpoint',
      '@leashmarket/seller-kit',
      'x402 API payments',
      'MPP API payments',
      'AI agent API monetization',
    ],
    tags: ['Seller kit', 'API monetization', 'x402', 'MPP', 'Explorer'],
    takeaways: [
      'seller-kit needs your Leash agent address because payTo is derived from that agent identity.',
      'The Monetize endpoint flow creates hosted x402 or MPP payable endpoints from an active marketplace API key.',
      'The List capability flow publishes your provider URL plus one or more payable endpoints to discovery.',
      'Explorer visibility requires receipt ingestion or an API-aware transaction path, not only a raw on-chain transfer.',
    ],
    useCase:
      'A useful API endpoint can become an agent-readable product when it advertises a price, accepts x402 or MPP payment, and ties every successful call to a Leash agent identity. First create a hosted payable endpoint in /creator/monetize; then publish the provider URL and payable endpoint in /creator/list so agents can discover what they can buy.',
    mechanics:
      'seller-kit mounts payment middleware onto your Hono app. `createSeller` speaks x402; `createMppSeller` speaks MPP. Both receive your Leash agent address, derive the seller Asset Signer PDA as the on-chain destination, advertise accepted stablecoins through the facilitator, and only call your route handler after the buyer signs and settlement succeeds.',
    checklist:
      'Create or reuse a Leash agent, select or create an active marketplace API key, choose x402 or MPP, pick USDC/USDT/USDG, create a hosted payable endpoint, list the provider plus payable endpoints in discovery when desired, wrap dynamic endpoints with seller-kit, and forward receipts to the Leash API or runner when you want explorer pages to update immediately.',
    codeBlocks: [
      codeBlock('Create a hosted payable endpoint from the creator flow', 'txt', [
        '1. Open /creator/monetize.',
        '2. Pick your Leash agent address.',
        '3. Choose x402 or MPP and USDC, USDT, or USDG.',
        '4. Select an active marketplace API key, or create one when the selector says no key found.',
        '5. Click Create payable endpoint.',
        '6. Optional: click Add to marketplace discovery to prefill /creator/list.',
        '7. In /creator/list, publish the provider URL and payable endpoint description.',
      ]),
      codeBlock('Seller-kit route', 'ts', [
        "import { Hono } from 'hono';",
        "import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';",
        "import { mplCore } from '@metaplex-foundation/mpl-core';",
        "import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';",
        "import { createSeller } from '@leashmarket/seller-kit';",
        '',
        'const app = new Hono();',
        'const umi = createUmi(process.env.SOLANA_RPC)',
        '  .use(mplCore())',
        '  .use(mplToolbox());',
        '',
        "process.env.LEASH_API_URL = 'https://api.leash.market';",
        "process.env.LEASH_API_KEY = '<your-leash-api-key>';",
        '',
        'createSeller(app, {',
        '  umi,',
        "  sellerAgent: { asset: '<your-leash-agent-address>' },",
        "  network: 'solana-devnet',",
        "  facilitator: 'https://facilitator-devnet.leash.market',",
        '  routes: {',
        "    'GET /paid/quote': {",
        "      description: 'Paid quote endpoint',",
        "      price: '0.001 USDC',",
        "      currency: 'USDC',",
        "      acceptsCurrencies: ['USDT', 'USDG'],",
        '    },',
        '  },',
        '});',
        '',
        "app.post('/paid/quote', async (c) => {",
        '  const { query } = await c.req.json();',
        "  const upstream = await fetch('https://api.example-search.com/v1/search', {",
        "    method: 'POST',",
        "    headers: { 'content-type': 'application/json' },",
        '    body: JSON.stringify({ query, limit: 5 }),',
        '  });',
        "  if (!upstream.ok) return c.json({ error: 'search_failed' }, 502);",
        '  const data = await upstream.json();',
        '  return c.json({ ok: true, results: data.results });',
        '});',
      ]),
      codeBlock('Smoke-test the paid endpoint', 'sh', [
        '# Starts a local seller route, confirms the unpaid 402, then pays with buyer-kit.',
        'pnpm --filter @leashmarket/api exec tsx \\',
        '  --env-file-if-exists=.env.e2e \\',
        '  scripts/seller-kit-local-smoke.ts',
      ]),
      codeBlock('Forward receipts for explorer visibility', 'ts', [
        'createSeller(app, {',
        '  umi,',
        '  sellerAgent: { asset: process.env.LEASH_SELLER_AGENT! },',
        '  network,',
        '  routes,',
        '  onReceipt: async (receipt) => {',
        '    await fetch(`${process.env.LEASH_API_URL}/v1/receipts/${receipt.agent}`, {',
        "      method: 'POST',",
        '      headers: {',
        "        'content-type': 'application/json',",
        '        authorization: `Bearer ${process.env.LEASH_API_KEY}`',
        '      },',
        '      body: JSON.stringify(receipt),',
        '    });',
        '  },',
        '});',
      ]),
    ],
    faqs: [
      {
        question: 'Why does seller-kit need a seller agent?',
        answer:
          'seller-kit derives the seller payTo address from your Leash agent address. That keeps payment, receipts, and reputation attached to the agent identity instead of a loose wallet address.',
      },
      {
        question: 'Should I choose x402 or MPP?',
        answer:
          'Use x402 when you want standard HTTP 402 payment-required semantics. Use MPP when your buyer clients prefer problem+json negotiation. Leash keeps both attached to the same agent identity and receipt model.',
      },
      {
        question: 'Do I have to list the endpoint in marketplace discovery?',
        answer:
          'No. A hosted payment link can stay private. Discovery is only for endpoints you want agents to find through browse, search, and reputation surfaces.',
      },
      {
        question: 'Why did my smoke-test transaction not appear in the explorer?',
        answer:
          'The smoke script proved settlement locally but kept receipts in memory. Explorer pages update when the Leash API/indexer knows about the event, usually through receipt forwarding, runner forwarding, or API prepare/sign/submit flows that watch the agent.',
      },
    ],
    docsLinks: [
      docs('/sdk/seller-kit', 'seller-kit docs'),
      docs('/guides/create-an-endpoint', 'Create an endpoint'),
      docs('/api/payment-links', 'Payment links API'),
    ],
    relatedArticles: [
      'how-to-build-paid-api-leashmarket-seller-kit',
      'what-is-x402-on-solana',
      'how-receipts-become-ai-agent-reputation',
    ],
  },
  {
    slug: 'how-to-build-autonomous-buyer-leashmarket-buyer-kit',
    title: 'How to build an autonomous buyer with @leashmarket/buyer-kit',
    eyebrow: 'Buyer kit',
    category: 'Packages',
    audience: 'Agent developers paying APIs programmatically',
    description:
      'Use @leashmarket/buyer-kit to evaluate policy, verify seller identity, settle x402 payments, and emit spend receipts.',
    keywords: ['@leashmarket/buyer-kit', 'autonomous buyer agent', 'x402 buyer'],
    tags: ['Buyer kit', 'Policy', 'x402', 'Receipts'],
    takeaways: [
      'buyer-kit wraps fetch with policy and payment behavior.',
      'Identity preflight can block untrusted sellers.',
      'Spend receipts make agent activity auditable.',
    ],
    useCase:
      'An autonomous buyer needs a single call path that checks policy, verifies the seller, pays the API, and records proof.',
    mechanics:
      'buyer-kit evaluates RulesV1, optionally calls Leash identity verification, handles x402 settlement through the SVM adapter, and returns response plus receipt.',
    checklist:
      'Configure agent mint, signer, policy, networks, RPC URL, optional seller identity requirements, and an onReceipt sink.',
    codeBlocks: [
      codeBlock('Create an identity-aware buyer', 'ts', [
        "import { createBuyer } from '@leashmarket/buyer-kit';",
        '',
        'const buyer = createBuyer({',
        '  agent: agentMint,',
        '  rules: {',
        "    v: '0.1',",
        "    budget: { daily: '10', perCall: '0.01', currency: 'USDC' },",
        "    hosts: { allow: ['api.example.com'] },",
        '    triggers: [{ type: "interval", seconds: 60 }],',
        '  },',
        '  signer,',
        "  networks: ['solana-devnet'],",
        "  rpcUrl: 'https://api.devnet.solana.com',",
        "  identity: { selector: { handle: 'seller-agent' }, capability: { slug: 'seller/tag-api', protocol: 'x402' } },",
        '});',
        '',
        'const { response, receipt } = await buyer.fetch(url);',
      ]),
    ],
    faqs: [
      {
        question: 'What happens on a deny verdict?',
        answer:
          'buyer-kit can block the request before payment and emit a denied spend receipt for auditability.',
      },
      {
        question: 'Can buyer-kit run in browsers?',
        answer:
          'Browser usage depends on the signer and integration shape. The docs cover Privy and wallet-adapter style setups.',
      },
    ],
    docsLinks: [
      docs('/sdk/buyer-kit', 'buyer-kit docs'),
      docs('/guides/build-a-buyer', 'Build a buyer'),
    ],
    relatedArticles: [
      'agent-to-agent-verification-before-paying-api',
      'how-leash-policy-keeps-ai-agents-inside-limits',
      'how-receipts-become-ai-agent-reputation',
    ],
  },
  {
    slug: 'how-to-verify-seller-identity-leashmarket-sdk',
    title: 'How to verify seller identity with @leashmarket/sdk',
    eyebrow: 'SDK',
    category: 'Packages',
    audience: 'JavaScript developers integrating Leash identity checks',
    description:
      'Use @leashmarket/sdk to resolve agent identities, inspect seller metadata, and request trust decisions before paying a capability.',
    keywords: ['@leashmarket/sdk verify seller', 'Leash SDK identity', 'verifyCapabilitySeller'],
    tags: ['SDK', 'Identity verification', 'Marketplace', 'Reputation'],
    takeaways: [
      'The SDK exposes public identity reads.',
      'Discovery results can carry seller identity summaries.',
      'verifyCapabilitySeller requests a capability-aware trust decision.',
    ],
    useCase:
      'Apps that call paid capabilities need a safe preflight step before initiating payment or displaying a seller as verified.',
    mechanics:
      'The SDK wraps the Identity API and discovery endpoints with typed helpers for resolveIdentity, verifyIdentityDecision, verifyCapabilitySeller, reputation, and disclosures.',
    checklist:
      'Resolve the seller, compare the returned mint to the listing metadata, request a capability seller verdict, and surface warn or deny states in your product.',
    codeBlocks: [
      codeBlock('Verify a seller capability', 'ts', [
        "import { LeashClient } from '@leashmarket/sdk';",
        '',
        'const leash = new LeashClient({ baseUrl: "https://api.leash.market" });',
        'const decision = await leash.verifyCapabilitySeller({',
        '  selector: { mint: sellerMint },',
        "  capability: { slug: 'premium-search', protocol: 'x402' },",
        '  thresholds: { require_verified_domain: true },',
        '});',
        '',
        "if (decision.verdict !== 'allow') console.warn(decision.checks);",
      ]),
    ],
    faqs: [
      {
        question: 'Is the public SDK allowed to mutate identities?',
        answer:
          'No. Public SDK helpers stay focused on safe reads and verification. Owner mutations live behind authenticated app or admin flows.',
      },
      {
        question: 'Can I verify by handle or domain?',
        answer: 'Yes. Verification accepts mint, handle, or verified domain selectors.',
      },
    ],
    docsLinks: [docs('/agents/sdk', 'TypeScript SDK'), docs('/sdk/sdk', 'SDK reference')],
    relatedArticles: [
      'agent-to-agent-verification-before-paying-api',
      'how-to-build-paid-api-leashmarket-seller-kit',
      'how-to-discover-ai-agent-capabilities-leash-market',
    ],
  },
  {
    slug: 'how-to-mint-verify-pay-leash-cli',
    title: 'How to mint, verify, and pay with the Leash CLI',
    eyebrow: 'CLI',
    category: 'Packages',
    audience: 'Developers who prefer terminal workflows',
    description:
      'Use the Leash CLI to create agent identities, discover capabilities, verify sellers, pay x402 links, inspect receipts, and withdraw funds.',
    keywords: ['Leash CLI', 'leash agent create', 'AI agent CLI'],
    tags: ['CLI', 'Agent identity', 'x402', 'Receipts'],
    takeaways: [
      'The CLI shares agent.json with the MCP server.',
      'You can verify seller identity before payment.',
      'Receipts, history, treasury, and spend limits are all available from the terminal.',
    ],
    useCase:
      'The CLI is the fastest way to exercise the Leash identity layer without opening the hosted agent app.',
    mechanics:
      'The leash binary reads local config, talks to the Leash API, signs with the configured executive key, and can settle x402 or MPP links from the terminal.',
    checklist:
      'Install the CLI, create or import an agent, set RPC configuration, discover capabilities, verify the counterparty, pay, and inspect receipts.',
    codeBlocks: [
      codeBlock('CLI path from identity to payment', 'bash', [
        'npm install -g @leashmarket/cli',
        'leash agent create --name "Ops Agent" --description "Runs paid ops workflows."',
        'leash discover -q email --source all',
        'leash identity verify --handle seller-agent --intent pay --protocol x402 --require-domain',
        'leash pay https://example.com/x/abc123',
        'leash receipts --limit 5',
      ]),
    ],
    faqs: [
      {
        question: 'Can the CLI use devnet?',
        answer: 'Yes. Set LEASH_NETWORK=solana-devnet or use the matching config in agent.json.',
      },
      {
        question: 'Is the CLI separate from MCP?',
        answer:
          'The interfaces are separate, but they share the same local agent configuration and identity model.',
      },
    ],
    docsLinks: [docs('/agents/cli', 'CLI guide'), docs('/quickstart', 'Quickstart')],
    relatedArticles: [
      'how-to-create-ai-agent-identity-solana',
      'how-to-give-ai-agent-leash-tools-through-mcp',
      'which-leash-npm-package-should-you-use',
    ],
  },
  {
    slug: 'how-to-give-ai-agent-leash-tools-through-mcp',
    title: 'How to give an AI agent Leash tools through MCP',
    eyebrow: 'MCP',
    category: 'Packages',
    audience: 'Developers adding Leash to coding agents and chat agents',
    description:
      'Install the Leash MCP server so an AI agent can resolve identities, discover capabilities, inspect receipts, and pay x402 links.',
    keywords: ['Leash MCP', 'AI agent MCP tools', '@leashmarket/mcp'],
    tags: ['MCP', 'AI agents', 'Tools', 'Identity'],
    takeaways: [
      'MCP gives agents direct access to Leash tools.',
      'The server can start without an agent and guide onboarding.',
      'The same identity can move across MCP hosts.',
    ],
    useCase:
      'If an AI agent runs in Cursor, Claude Desktop, Cline, Continue, or another MCP host, Leash MCP gives it identity and payment tools through STDIO.',
    mechanics:
      'The MCP server reads agent.json or environment overrides, exposes canonical Leash tools, and signs local payments or treasury actions with the executive key where available.',
    checklist:
      'Install the MCP server, configure RPC, register or import an agent, verify identity, then use discovery and payment tools from the host agent.',
    codeBlocks: [
      codeBlock('MCP server config', 'json', [
        '{',
        '  "mcpServers": {',
        '    "leash": {',
        '      "command": "npx",',
        '      "args": ["-y", "@leashmarket/mcp"],',
        '      "env": {',
        '        "LEASH_NETWORK": "solana-devnet",',
        '        "LEASH_RPC_URL": "https://api.devnet.solana.com"',
        '      }',
        '    }',
        '  }',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Does MCP require a browser session?',
        answer:
          'No. The standalone MCP server runs locally and communicates over STDIO with the host.',
      },
      {
        question: 'Can an identity move between MCP hosts?',
        answer:
          'Yes. Export and import agent.json to move the same identity, treasury, and reputation context.',
      },
    ],
    docsLinks: [docs('/agents/mcp', 'MCP guide'), docs('/sdk/mcp-core', 'mcp-core reference')],
    relatedArticles: [
      'how-mcp-tools-become-agent-capabilities',
      'how-to-mint-verify-pay-leash-cli',
      'which-leash-npm-package-should-you-use',
    ],
  },
  {
    slug: 'how-mcp-tools-become-agent-capabilities',
    title: 'How MCP tools become agent capabilities',
    eyebrow: 'MCP capabilities',
    category: 'Marketplace',
    audience: 'MCP builders and capability marketplace users',
    description:
      'MCP tools can be represented as capabilities so AI agents can discover, pin, call, and build proof around them.',
    keywords: ['MCP capabilities', 'AI agent tools marketplace', 'Leash capabilities'],
    tags: ['MCP', 'Capabilities', 'Marketplace', 'Tools'],
    takeaways: [
      'Tools become more useful when attached to identity metadata.',
      'Capability listings can include protocols, pricing, seller identity, and endpoints.',
      'Receipts can prove paid tool calls happened.',
    ],
    useCase:
      'MCP tool directories are useful, but agents need more than a list. They need to know who offers the tool, what it costs, and whether the provider is trustworthy.',
    mechanics:
      'Leash groups MCP tools, paid APIs, pay.sh providers, and native agent services as capabilities attached to identities or external catalogues.',
    checklist:
      'Normalize the tool into a capability card, include protocols and pricing, link seller identity when available, and make add-to-agent flow land in favorites.',
    codeBlocks: [
      codeBlock('Capability fields for an MCP tool', 'json', [
        '{',
        '  "source": "leash",',
        '  "category": "search",',
        '  "protocols": ["x402"],',
        '  "tools": [{ "name": "web_search" }],',
        '  "seller_agent_mint": "Agnt..."',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Are MCP tools and paid APIs both capabilities?',
        answer:
          'Yes. Leash uses capability as the broader identity-level concept for things agents can use or sell.',
      },
      {
        question: 'Does every capability have a Leash seller identity?',
        answer:
          'Native listings can be identity-backed. External pay.sh entries remain read-only until they attach a Leash identity.',
      },
    ],
    docsLinks: [docs('/concepts/capabilities', 'Capabilities'), docs('/agents/mcp', 'MCP server')],
    relatedArticles: [
      'how-to-discover-ai-agent-capabilities-leash-market',
      'what-pay-sh-capabilities-mean-inside-leash',
      'how-to-give-ai-agent-leash-tools-through-mcp',
    ],
  },
  {
    slug: 'how-to-discover-ai-agent-capabilities-leash-market',
    title: 'How to discover AI agent capabilities on leash.market',
    eyebrow: 'Marketplace',
    category: 'Marketplace',
    audience: 'Agent operators looking for tools and APIs',
    description:
      'Use leash.market to discover native Leash listings and pay.sh APIs as capabilities your agent identity can pin and call.',
    keywords: ['AI agent capabilities marketplace', 'leash.market browse', 'pay.sh capabilities'],
    tags: ['Marketplace', 'Discovery', 'pay.sh', 'Capabilities'],
    takeaways: [
      'Browse merges Leash listings and pay.sh/pay-skills APIs.',
      'Source badges clarify native versus external capabilities.',
      'Add capability deep-links into the agent app favorites surface.',
    ],
    useCase:
      'An agent identity should be able to find tools, paid endpoints, and services without manually stitching together multiple catalogues.',
    mechanics:
      'The marketplace uses merged discovery results, labels each item by source, and routes capability saving into the agent app so the active identity can pin it.',
    checklist:
      'Search by task, inspect source and pricing, open the detail page, review seller identity when present, then add the capability to the active agent.',
    codeBlocks: [
      codeBlock('Query discovery from an app route or script', 'ts', [
        "const response = await fetch('/api/discover?source=all&limit=12&q=email');",
        'const { items } = await response.json();',
        'for (const item of items) {',
        '  console.log(item.source, item.title, item.seller_identity?.handle);',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Why call all of these capabilities?',
        answer:
          'Because the directory includes MCP tools, paid API endpoints, agent services, and external pay.sh providers that agents can use.',
      },
      {
        question: 'Where does Add capability go?',
        answer:
          'It deep-links to the agent app favorites surface so the active identity can save or attach the capability.',
      },
    ],
    docsLinks: [
      docs('/concepts/capabilities', 'Capabilities concept'),
      docs('/agents/sdk', 'SDK discover'),
    ],
    relatedArticles: [
      'capability-cards-for-ai-agents',
      'what-pay-sh-capabilities-mean-inside-leash',
      'how-to-list-identity-backed-marketplace-capability',
    ],
  },
  {
    slug: 'how-to-list-identity-backed-marketplace-capability',
    title: 'How to list an identity-backed marketplace capability',
    eyebrow: 'Creator marketplace',
    category: 'Marketplace',
    audience: 'Developers publishing paid APIs or tools',
    description:
      'List a native marketplace capability with a seller agent identity so buyers can verify who provides the endpoint.',
    keywords: ['identity-backed marketplace listing', 'list agent capability', 'seller agent mint'],
    tags: ['Marketplace', 'Seller identity', 'Capabilities', 'Listings'],
    takeaways: [
      'New native listings should be linked to an owned seller agent identity.',
      'Approved listings can become public capability cards.',
      'Legacy unlinked listings should be marked unverified until linked.',
    ],
    useCase:
      'A paid API directory is stronger when every native listing can point to the agent identity responsible for it.',
    mechanics:
      'Leash marketplace submissions include seller_agent_mint, enrich detail pages with seller identity summaries, and sync approved listings into capability cards.',
    checklist:
      'Create or select your seller identity, submit the listing metadata, include endpoint and pricing, then verify the seller identity panel after it appears in marketplace discovery.',
    codeBlocks: [
      codeBlock('Listing identity metadata', 'json', [
        '{',
        '  "name": "Premium Web Search",',
        '  "slug": "premium-web-search",',
        '  "endpoint": "https://search.example/mcp",',
        '  "pricing": { "type": "per_call", "amount": "0.01", "currency": "USDC" },',
        '  "seller_agent_mint": "Agnt..."',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Do old listings disappear if they are not linked?',
        answer:
          'No. Legacy listings can remain visible but should be clearly marked as unverified until linked.',
      },
      {
        question: 'Why require a seller agent mint?',
        answer:
          'It lets buyers connect the capability to a verifiable identity, reputation summary, and proof trail.',
      },
    ],
    docsLinks: [
      docs('/api/monetize-api', 'Monetise an API'),
      docs('/concepts/capabilities', 'Capabilities'),
    ],
    relatedArticles: [
      'how-to-build-paid-api-leashmarket-seller-kit',
      'how-to-verify-seller-identity-leashmarket-sdk',
      'how-to-discover-ai-agent-capabilities-leash-market',
    ],
  },
  {
    slug: 'what-pay-sh-capabilities-mean-inside-leash',
    title: 'What pay.sh capabilities mean inside Leash',
    eyebrow: 'pay.sh',
    category: 'Marketplace',
    audience: 'Agents browsing external paid APIs',
    description:
      'Leash surfaces pay.sh/pay-skills providers as external capabilities so agents can discover paid APIs alongside native identity-backed listings.',
    keywords: ['pay.sh capabilities', 'pay-skills registry', 'external agent APIs'],
    tags: ['pay.sh', 'pay-skills', 'Marketplace', 'External capabilities'],
    takeaways: [
      'pay.sh entries are external, read-only capabilities.',
      'Endpoint counts should match capability counts.',
      'They can still be pinned by an agent identity.',
    ],
    useCase:
      'Agents should not need separate directories for every paid API ecosystem. pay.sh providers can appear in the same discovery experience.',
    mechanics:
      'Leash fetches pay-skills registry data, labels it with source pay-skills, expands providers into endpoints, and keeps seller identity null until a provider attaches a Leash identity.',
    checklist:
      'Search pay.sh providers, inspect endpoint count and pricing, open the detail page, and add the provider to the agent favorites library if it is useful.',
    codeBlocks: [
      codeBlock('Discover and expand pay.sh providers', 'bash', [
        'leash discover -q email --source pay-skills',
        'leash discover endpoints agentmail/email',
      ]),
    ],
    faqs: [
      {
        question: 'Are pay.sh providers Leash-verified sellers?',
        answer:
          'Not by default. They are valid external capabilities, but seller_identity remains null unless linked to a Leash identity.',
      },
      {
        question: 'Why show endpoint count as capability count?',
        answer:
          'For pay.sh providers, payable endpoints are the actionable capabilities an agent can call.',
      },
    ],
    docsLinks: [
      docs('/agents/cli', 'CLI discover'),
      docs('/concepts/capabilities', 'Capabilities'),
    ],
    relatedArticles: [
      'how-to-discover-ai-agent-capabilities-leash-market',
      'how-mcp-tools-become-agent-capabilities',
      'capability-cards-for-ai-agents',
    ],
  },
  {
    slug: 'how-to-use-leash-playground',
    title: 'How to use the Leash playground',
    eyebrow: 'Playground',
    category: 'Playground',
    audience: 'Developers testing Leash locally',
    description:
      'Use the Leash playground to inspect agents, treasuries, schemas, runner feeds, seller routes, buyer payments, and receipt validation.',
    keywords: ['Leash playground', 'AI agent payment playground', 'test Leash locally'],
    tags: ['Playground', 'Testing', 'Agents', 'Schemas'],
    takeaways: [
      'The playground wraps SDK packages behind browser-safe API routes.',
      'It can mint agents with a Privy wallet.',
      'It gives visual flows for buyer, seller, runner, and schema testing.',
    ],
    useCase:
      'Before wiring Leash into production, the playground gives developers a controlled UI for exploring the stack end to end.',
    mechanics:
      'The playground exposes routes for agent identity, balances, executive status, buyer fire, seller echo, schema validation, and runner receipt feeds.',
    checklist:
      'Start the playground, configure Privy if needed, start the runner for green status, then test agents, buyer, seller, and schema pages.',
    codeBlocks: [
      codeBlock('Run the playground and runner', 'bash', [
        'cp apps/playground/.env.local.example apps/playground/.env.local',
        'pnpm install',
        'pnpm --filter @leashmarket/playground dev',
        'pnpm --filter @leashmarket/runner start',
      ]),
    ],
    faqs: [
      {
        question: 'Does the playground expose private keys to the browser?',
        answer:
          'The browser uses the connected Privy wallet for signing. Server-side fallback routes require explicit dev payer env configuration.',
      },
      {
        question: 'Which route validates schemas?',
        answer:
          'The /schemas page and POST /api/schemas/validate route validate Leash schema documents.',
      },
    ],
    docsLinks: [
      docs('/quickstart', 'Quickstart'),
      docs('/guides/create-an-agent', 'Create an agent'),
    ],
    relatedArticles: [
      'how-to-test-agent-payments-playground',
      'prepare-sign-submit-leash-transaction-lifecycle',
      'which-leash-npm-package-should-you-use',
    ],
  },
  {
    slug: 'how-to-test-agent-payments-playground',
    title: 'How to test agent payments in the playground',
    eyebrow: 'Payment testing',
    category: 'Playground',
    audience: 'Developers validating x402 flows before launch',
    description:
      'Test buyer and seller payment flows in the Leash playground before moving to a production API or automated agent.',
    keywords: ['test AI agent payments', 'Leash playground buyer seller', 'x402 payment test'],
    tags: ['Playground', 'Buyer kit', 'Seller kit', 'x402'],
    takeaways: [
      'The seller page shows 402 versus allowed behavior.',
      'The buyer page builds policy and fires paid fetch calls.',
      'Receipts can be inspected through runner feeds.',
    ],
    useCase:
      'Payment code is easiest to debug when the buyer, seller, policy, and receipt views are visible in one place.',
    mechanics:
      'The playground API routes wrap buyer-kit and seller-like behavior so browser actions can exercise the same core payment concepts.',
    checklist:
      'Start the runner, open seller and buyer pages, use a devnet-funded wallet, trigger a paid call, and inspect the resulting receipt feed.',
    codeBlocks: [
      codeBlock('Point demos at a local facilitator', 'bash', [
        'export LEASH_FACILITATOR_URL=http://localhost:8787',
        'pnpm --filter @leashmarket/playground dev',
        'pnpm --filter @leashmarket/runner start',
      ]),
    ],
    faqs: [
      {
        question: 'Can the playground test real settlement?',
        answer:
          'Yes, when configured with devnet funding, compatible signer setup, and a facilitator URL.',
      },
      {
        question: 'Where do receipts appear?',
        answer: 'Use the runner page or the /api/receipts/[mint] route to inspect parsed receipts.',
      },
    ],
    docsLinks: [
      docs('/guides/build-a-buyer', 'Build a buyer'),
      docs('/guides/build-a-seller', 'Build a seller'),
    ],
    relatedArticles: [
      'how-to-use-leash-playground',
      'what-is-x402-on-solana',
      'how-to-run-leash-facilitator',
    ],
  },
  {
    slug: 'how-receipts-become-ai-agent-reputation',
    title: 'How receipts become AI agent reputation',
    eyebrow: 'Receipts',
    category: 'Identity layer',
    audience: 'Teams building trust and ranking systems for agents',
    description:
      'Leash receipts turn agent activity into proof trails that can feed reputation, discovery, marketplace trust, and explorer views.',
    keywords: ['AI agent receipts', 'agent reputation', 'proof trails'],
    tags: ['Receipts', 'Reputation', 'Explorer', 'Proof'],
    takeaways: [
      'Receipts record what happened after real actions.',
      'Hash chaining makes tampering detectable.',
      'Reputation should be computed from behavior, not profile copy.',
    ],
    useCase:
      'A reputation score is only useful if it is grounded in verifiable activity. Receipts provide that substrate for agent identities.',
    mechanics:
      'Leash records earn and spend receipts with request, decision, pricing, settlement, and hash-chain fields that explorer and SDK clients can inspect.',
    checklist:
      'Emit receipts for settled buyer and seller actions, push or pull them into the runner/API, verify chains, and expose summaries on identity profiles.',
    codeBlocks: [
      codeBlock('Minimal receipt fields to inspect', 'json', [
        '{',
        '  "agent": "Agnt...",',
        '  "direction": "spend",',
        '  "receipt_hash": "c3c50c...",',
        '  "tx_sig": "5h...",',
        '  "prev_receipt_hash": "9ab...",',
        '  "decision": "allow"',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Do receipts replace reviews?',
        answer:
          'They do not replace qualitative reviews, but they provide objective evidence that can make reviews and ratings more trustworthy.',
      },
      {
        question: 'Can denied actions be useful?',
        answer:
          'Yes. Denied or warned actions can show that policy worked and that the agent stayed inside its limits.',
      },
    ],
    docsLinks: [
      docs('/concepts/receipt', 'Receipt concept'),
      docs('/api/receipts', 'Receipts API'),
    ],
    relatedArticles: [
      'identity-layer-for-ai-agents',
      'how-leash-policy-keeps-ai-agents-inside-limits',
      'agent-to-agent-verification-before-paying-api',
    ],
  },
  {
    slug: 'how-to-use-webhooks-agent-identity-events',
    title: 'How to use webhooks for agent identity events',
    eyebrow: 'Webhooks',
    category: 'API',
    audience: 'Developers integrating Leash events into backends',
    description:
      'Subscribe to Leash webhooks to receive signed agent identity, treasury, receipt, and lifecycle events in your own systems.',
    keywords: ['Leash webhooks', 'agent identity events', 'receipt webhook'],
    tags: ['Webhooks', 'API', 'Events', 'Receipts'],
    takeaways: [
      'Webhooks push identity and receipt events into your backend.',
      'Signatures let receivers verify authenticity.',
      'Delivery history and retries help debug integration failures.',
    ],
    useCase:
      'If your app needs to react when receipts publish, treasuries change, or agent lifecycle events happen, webhooks are the integration surface.',
    mechanics:
      'Leash sends signed webhook deliveries for subscribed events and stores delivery attempts so operators can inspect status and retries.',
    checklist:
      'Create a subscription, store the secret, verify signatures, handle retries idempotently, and keep event processing separate from user-facing latency.',
    codeBlocks: [
      codeBlock('Create a webhook with the SDK', 'ts', [
        "import { LeashClient } from '@leashmarket/sdk';",
        '',
        'const leash = new LeashClient({',
        '  agentMint: agentMint,',
        '  executiveSecretBase58: process.env.LEASH_EXECUTIVE_KEY!,',
        '});',
        '',
        'const sub = await leash.createWebhook({',
        "  url: 'https://my-app.example/leash-webhook',",
        "  events: ['receipt.published', 'agent.treasury.withdraw'],",
        '});',
        'console.log(sub.secret);',
      ]),
    ],
    faqs: [
      {
        question: 'Should webhook handlers be idempotent?',
        answer:
          'Yes. Delivery retries are expected in distributed systems, so handlers should de-duplicate by event id.',
      },
      {
        question: 'Are webhook signatures optional?',
        answer: 'No. Production receivers should verify the signature before trusting the payload.',
      },
    ],
    docsLinks: [docs('/api/webhooks', 'Webhooks'), docs('/api/idempotency', 'Idempotency')],
    relatedArticles: [
      'connector-data-sources-power-leash-automations',
      'how-receipts-become-ai-agent-reputation',
      'prepare-sign-submit-leash-transaction-lifecycle',
    ],
  },
  {
    slug: 'prepare-sign-submit-leash-transaction-lifecycle',
    title: 'Prepare, sign, submit: the Leash transaction lifecycle',
    eyebrow: 'Transaction lifecycle',
    category: 'API',
    audience: 'Polyglot developers integrating Solana actions',
    description:
      'Leash separates prepare, local signing, submit, and tracking so apps can use any wallet, HSM, or signing environment.',
    keywords: ['prepare sign submit', 'Leash transaction lifecycle', 'Solana agent API'],
    tags: ['API', 'Transactions', 'Solana', 'Tracking'],
    takeaways: [
      'Prepare endpoints build unsigned transaction envelopes.',
      'Signing stays local to the owner or operator.',
      'Submit and track events connect lifecycle phases to identity history.',
    ],
    useCase:
      'Apps should not have to hand private keys to an API server just to perform agent identity actions.',
    mechanics:
      'Leash prepare endpoints encode the action, clients sign locally, submit broadcasts the signed transaction, and tracking endpoints show prepared, submitted, confirmed, or failed phases.',
    checklist:
      'Call prepare, deserialize and sign with your wallet or HSM, submit the signed transaction, and track the event id until it reaches a terminal phase.',
    codeBlocks: [
      codeBlock('Prepare and submit shape', 'bash', [
        '# 1. Prepare',
        "curl -X POST 'https://api.leash.market/v1/agents/Agnt.../treasury/withdraw/prepare'",
        '',
        '# 2. Sign locally with your wallet or HSM.',
        '# 3. Submit signed transaction.',
        "curl -X POST 'https://api.leash.market/v1/submit' \\",
        "  -H 'Content-Type: application/json' \\",
        '  -d \'{ "event_id": "evt_...", "signed_tx": "BASE64..." }\'',
      ]),
    ],
    faqs: [
      {
        question: 'Why split prepare and submit?',
        answer:
          'It keeps signing local while still letting the API provide consistent transaction construction and tracking.',
      },
      {
        question: 'What should clients track?',
        answer:
          'Track the event id and phase. It is the stable handle for retries and status updates.',
      },
    ],
    docsLinks: [
      docs('/api/prepare-submit', 'Prepare submit lifecycle'),
      docs('/api/explorer-tracking', 'Explorer tracking'),
    ],
    relatedArticles: [
      'operator-history-delegation-ai-agents',
      'how-to-fund-ai-agent-set-spend-limits',
      'how-to-use-webhooks-agent-identity-events',
    ],
  },
  {
    slug: 'how-to-fund-ai-agent-set-spend-limits',
    title: 'How to fund an AI agent and set spend limits',
    eyebrow: 'Spend limits',
    category: 'Agents app',
    audience: 'Operators funding autonomous agents',
    description:
      'Fund an AI agent treasury and set per-token delegation limits so the agent can pay for work without unlimited risk.',
    keywords: ['fund AI agent', 'agent spend limits', 'Leash treasury delegation'],
    tags: ['Treasury', 'Spend limits', 'USDC', 'Delegation'],
    takeaways: [
      'Funding and delegation are separate decisions.',
      'Each stablecoin can have its own spend cap.',
      'Revoking delegation pauses outgoing settlement authority.',
    ],
    useCase:
      'An agent may need enough USDC to call APIs, but the operator should still be able to cap or revoke what the executive can spend.',
    mechanics:
      'Leash uses treasury token accounts and SPL Approve delegation so the executive can spend within the configured token authority.',
    checklist:
      'Create stable ATAs if needed, fund the treasury, set an amount limit, test one paid call, and monitor receipts plus balance changes.',
    codeBlocks: [
      codeBlock('Set and revoke spend limits', 'bash', [
        'leash treasury balance',
        'leash treasury set-limit --token USDC --amount 2',
        'leash treasury limit --token USDC',
        'leash treasury set-limit --token USDC --revoke',
      ]),
    ],
    faqs: [
      {
        question: 'Is the default delegation unlimited?',
        answer:
          'Some provisioning paths set broad delegation for smooth settlement. Operators should tighten caps for production workloads.',
      },
      {
        question: 'Does revoking delegation withdraw funds?',
        answer:
          'No. Revocation removes spend authority. Funds remain in the treasury until withdrawn by an authorized owner flow.',
      },
    ],
    docsLinks: [
      docs('/guides/fund-an-agent', 'Fund an agent'),
      docs('/api/treasury', 'Treasury API'),
    ],
    relatedArticles: [
      'what-is-agent-treasury',
      'how-leash-policy-keeps-ai-agents-inside-limits',
      'operator-history-delegation-ai-agents',
    ],
  },
  {
    slug: 'which-leash-npm-package-should-you-use',
    title: 'Which Leash npm package should you use?',
    eyebrow: 'Package guide',
    category: 'Packages',
    audience: 'Developers choosing an integration surface',
    description:
      'Choose between @leashmarket/sdk, CLI, MCP, buyer-kit, seller-kit, core, registry-utils, schemas, runner, and testing packages.',
    keywords: ['Leash npm packages', '@leashmarket/sdk', '@leashmarket/mcp'],
    tags: ['Packages', 'SDK', 'MCP', 'Developer tools'],
    takeaways: [
      'Use the SDK for public API reads and app integrations.',
      'Use MCP or CLI for agent operation and local signing.',
      'Use buyer-kit and seller-kit for payment flows.',
    ],
    useCase:
      'Leash is a system, not one package. Picking the right package first keeps the integration small and understandable.',
    mechanics:
      'The packages share schemas and identity primitives but target different runtimes: apps, CLI, MCP hosts, sellers, buyers, protocol helpers, and tests.',
    checklist:
      'Start with the surface closest to your job: SDK for app code, MCP for AI agents, CLI for terminal ops, seller-kit for paid APIs, buyer-kit for autonomous callers, and schemas/core for low-level protocol work.',
    codeBlocks: [
      codeBlock('Install the most common packages', 'bash', [
        'npm install @leashmarket/sdk',
        'npm install @leashmarket/buyer-kit @leashmarket/seller-kit',
        'npm install -g @leashmarket/cli',
        'npx -y @leashmarket/mcp',
      ]),
    ],
    faqs: [
      {
        question: 'Which package creates agents?',
        answer:
          'Use the CLI or MCP for local provisioning workflows. The SDK focuses on public API reads and remote control of existing agents.',
      },
      {
        question: 'Which package should a paid API use?',
        answer:
          'Use seller-kit for x402 middleware and earn receipts, with SDK identity metadata where useful.',
      },
    ],
    docsLinks: [docs('/agents/sdk', 'SDK'), docs('/agents/mcp', 'MCP'), docs('/agents/cli', 'CLI')],
    relatedArticles: [
      'how-to-verify-seller-identity-leashmarket-sdk',
      'how-to-give-ai-agent-leash-tools-through-mcp',
      'how-to-build-paid-api-leashmarket-seller-kit',
    ],
  },
];

export const articlesGenerated20260521: BlogArticle[] = [
  existingIdentityArticle,
  ...programmaticArticleSpecs.map((spec) => makeGuideArticle(spec)),
];
