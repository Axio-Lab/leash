import { codeBlock, docs, type BlogArticle } from './helpers';

const publishedAt = '2026-05-27';

export const articlesGenerated20260527: BlogArticle[] = [
  {
    slug: 'why-leash-fits-agentic-wallets-and-agent-to-agent-settlement',
    title: 'Why Leash fits agentic wallets and agent-to-agent settlement',
    seoTitle: 'Know Your Agent infrastructure for AI agents: identity, payments, and reputation',
    seoDescription:
      'Learn how Leash helps AI agents prove identity, verify counterparties, hold treasuries, sell services, pay with x402/MPP, and build receipt-backed reputation.',
    eyebrow: 'Agentic economy',
    description:
      'AI agents need more than API keys and wallet addresses. Leash gives them Know Your Agent identity, treasury, spend policy, x402/MPP payment rails, and receipts that turn paid work into reputation.',
    category: 'Agent infrastructure',
    audience:
      'AI agent builders, marketplace operators, Web3 infrastructure teams, and founders mapping the agentic economy stack',
    publishedAt,
    readingMinutes: 12,
    keywords: [
      'agentic wallets',
      'AI agent wallet',
      'Know Your Agent',
      'agent-to-agent settlement',
      'x402 AI agents',
      'AI agent payments',
      'AI agents get paid',
      'Leash agent identity',
      'agent reputation receipts',
    ],
    tags: ['Agent identity', 'Agent wallets', 'x402', 'MPP', 'Reputation', 'Marketplace'],
    takeaways: [
      'An agentic wallet must combine identity, treasury, delegated permissions, payment rails, and proof of work.',
      'Leash anchors those pieces to one agent identity so buyers and sellers can transact without passing around loose wallet addresses.',
      'x402 and MPP settlement make paid API calls, trained-agent services, and marketplace capabilities programmable.',
      'Receipts turn payments into reputation, giving future buyers a reason to trust an agent before they pay.',
    ],
    docsLinks: [
      docs('/concepts/identities', 'Agent identities'),
      docs('/api/identity', 'Identity API'),
      docs('/standards/x402-on-solana', 'Real x402 on Solana'),
      docs('/standards/mpp-on-solana', 'MPP on Solana'),
      docs('/sdk/buyer-kit', 'Buyer kit'),
      docs('/sdk/seller-kit', 'Seller kit'),
      docs('/api/monetize-api', 'Monetise an existing API'),
    ],
    relatedArticles: [
      'identity-layer-for-ai-agents',
      'agent-to-agent-payments-for-paid-services',
      'how-receipts-become-ai-agent-reputation',
    ],
    cta: { label: 'Browse paid agent capabilities', href: '/browse' },
    faqs: [
      {
        question: 'What is an agentic wallet?',
        answer:
          'An agentic wallet is a wallet designed for autonomous agents. It needs a stable identity, a treasury, delegated spend permissions, policy controls, payment rails, and records of what the agent paid for or earned.',
      },
      {
        question: 'How does Leash help AI agents get paid?',
        answer:
          'Leash lets builders create paid endpoints and marketplace capabilities with x402 or MPP pricing. Buyer agents can pay those endpoints, receive the result, and generate receipts that connect payment activity to the seller identity.',
      },
      {
        question: 'Can buyer agents pay without exposing the owner wallet?',
        answer:
          'Yes. Leash separates long-term owner authority from operational execution. An executive signer can be delegated for day-to-day payments while policy and spend limits keep the agent inside configured boundaries.',
      },
      {
        question: 'Is Leash a compliance or KYC product?',
        answer:
          'Leash provides Know Your Agent primitives such as handles, verified domains, claims, selective disclosure, reputation, and verification decisions. Regulated KYC, AML, and sanctions checks can be layered on top, but they are not implied by default.',
      },
    ],
    sections: [
      {
        id: 'agents-need-wallets-that-can-earn',
        title: 'AI agents need wallets that can earn, not just hold funds',
        body: [
          'Most agent payment demos stop at the wrong layer. They show an AI agent with an API key, a hot wallet, or a human-controlled checkout flow. That is not enough for the agent economy. A useful agent needs to discover services, verify who it is paying, spend within policy, receive money for its own work, and prove what happened later.',
          'That is the real job of an agentic wallet. It is not just a keypair. It is the economic identity of the agent: the place where funds, permissions, capabilities, receipts, and reputation meet. Leash is built for that job.',
          'With Leash, one agent identity can anchor the treasury, seller profile, buyer profile, marketplace listings, payment history, verified domains, claims, and reputation trail. That makes it easier for another agent to decide whether to trust, pay, or rent a capability.',
        ],
      },
      {
        id: 'what-agentic-wallets-must-do',
        title: 'What an agentic wallet must do before agents can transact',
        body: [
          'An agentic wallet has to answer five practical questions. Who is this agent? Where does it receive funds? Who is allowed to spend? What is it allowed to pay for? What proof remains after a transaction?',
          'A normal wallet address only answers one of those questions. A marketplace profile only answers part of another. Leash combines the pieces: agent identity, treasury, delegated authority, policy, x402 and MPP settlement, and hash-chained receipts.',
          'That makes the payment flow machine-readable. A buyer agent can discover a capability, inspect the seller, check the expected request body, evaluate trust, pay, receive the response, and keep a receipt for future reputation scoring.',
        ],
        codeBlocks: [
          codeBlock('Agentic wallet checklist', 'txt', [
            'Identity: a stable agent handle and onchain identity',
            'Treasury: an account that can receive and spend funds',
            'Delegation: owner, executive, and operator responsibilities',
            'Policy: limits for where and how the agent can spend',
            'Settlement: x402 and MPP payments for paid services',
            'Receipts: proof of spend, earn, result, and counterparty history',
          ]),
        ],
      },
      {
        id: 'how-leash-turns-an-agent-into-a-business',
        title: 'How Leash turns an AI agent into a paid service business',
        body: [
          'The highest-converting way to understand Leash is simple: if your agent can produce useful work, Leash helps you package that work into something other agents can pay for.',
          'A seller can monetize an existing API, publish a hosted Leash paywall, or list a trained-agent capability in the marketplace. The endpoint carries the method, price, payment rail, currency, upstream URL, and optional `metadata.expected_request_body` for POST calls. A buyer agent sees the contract before it pays.',
          'After payment, Leash can forward the buyer request to the seller upstream and return the result. That means the seller does not need to rebuild its service around a custom billing system. The paid endpoint becomes the economic wrapper around the service.',
        ],
        codeBlocks: [
          codeBlock('Seller path', 'txt', [
            '1. Start with an existing API or trained agent capability',
            '2. Create a Leash payable endpoint with x402 or MPP pricing',
            '3. Attach the endpoint to an agent identity and marketplace listing',
            '4. Let buyer agents discover, verify, pay, and call it',
            '5. Use receipts as proof of paid work and reputation',
          ]),
        ],
      },
      {
        id: 'why-buyers-trust-agent-identities',
        title: 'Why buyer agents need Know Your Agent before they pay',
        body: [
          'Agent-to-agent commerce fails if every buyer has to trust an anonymous URL. Before paying, a buyer agent needs to know whether the seller identity exists, which domain it controls, what capabilities it claims, whether it has public receipts, and whether policy should allow the transaction.',
          'Leash identity gives sellers a handle, verified domains, capability cards, signed claims, selective disclosures, operator history, and reputation summaries. Those signals let a buyer agent make a more informed payment decision before it signs a settlement.',
          'This is why Leash is not just a checkout layer. It is Know Your Agent infrastructure for paid services. Payment and trust checks sit in the same flow, so agents can transact without depending on screenshots, copied wallet addresses, or one-off allowlists.',
        ],
      },
      {
        id: 'agent-to-agent-settlement-flow',
        title: 'The agent-to-agent settlement flow Leash makes programmable',
        body: [
          'A high-converting AI agent payment flow should not send a user to a manual checkout page. The agent should be able to discover a service, receive a payment requirement, settle, retry, and get the result inside the same workflow.',
          'Leash supports that pattern with x402 and MPP. Sellers can expose paid services, while buyer agents can use buyer-kit, MCP tools, or the SDK to pay from an agent treasury. The result is a programmable settlement loop for API calls, data services, research agents, design agents, finance agents, and other paid capabilities.',
          'The important part is what happens after payment. Leash preserves the economic context through receipts, so the call can become part of reputation instead of disappearing into a raw transaction history.',
        ],
        codeBlocks: [
          codeBlock('Buyer path', 'txt', [
            '1. Discover a marketplace capability or payable URL',
            '2. Inspect method, price, rail, seller identity, and expected body',
            '3. Run policy and trust checks',
            '4. Pay the x402 or MPP requirement',
            '5. Receive the service response',
            '6. Store a spend receipt and update reputation inputs',
          ]),
        ],
      },
      {
        id: 'receipts-create-agent-reputation',
        title: 'Receipts are the SEO of the agent economy',
        body: [
          'Search engines rank web pages because pages leave signals. Agent marketplaces will need the same idea for services. If an agent has no receipts, no verified domain, no capability history, and no payment trail, a buyer has little reason to trust it.',
          'Leash receipts create the raw material for agent reputation. They connect the agent, seller, buyer, price, rail, decision, request context, settlement signature, and previous receipt hash. Over time, that trail can show which agents actually deliver useful work.',
          'For sellers, this creates compounding trust. The first paid calls are not just revenue. They become proof that future buyers can evaluate.',
        ],
      },
      {
        id: 'who-should-use-leash',
        title: 'Who should use Leash now',
        body: [
          'Use Leash if you are building an agent that needs to pay for tools, rent APIs, sell services, or expose a paid capability to other agents. It is especially useful for research agents, design agents, content agents, finance agents, monitoring agents, and workflow agents that need a clean payment path.',
          'Use Leash if you already have an API and want to make it payable without building billing from scratch. Hosted Leash paywalls can wrap an upstream endpoint, document expected POST bodies, settle payment, and forward paid requests.',
          'Use Leash if you operate a marketplace or agent platform and need identity, verification, receipts, and reputation around paid agent activity.',
        ],
      },
      {
        id: 'start-building',
        title: 'Start with one paid capability',
        body: [
          'The fastest way to understand Leash is to publish one paid capability. Create or select an agent identity, attach a payable endpoint, choose a price and rail, list the service, then run one real buyer call. That single loop proves the whole system: identity, payment, execution, receipt, and reputation.',
          'The agent economy will not be built from static profiles. It will be built from agents that can transact. Leash gives those agents the economic layer they need to safely pay, get paid, and prove what happened.',
        ],
        codeBlocks: [
          codeBlock('One-line pitch', 'txt', [
            'Leash gives AI agents an identity, wallet, policy, x402/MPP payment rails, and receipts so they can get paid and transact safely.',
          ]),
        ],
      },
    ],
  },
];
