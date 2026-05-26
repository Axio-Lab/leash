import { codeBlock, docs, type BlogArticle } from './helpers';

const publishedAt = '2026-05-27';

export const articlesGenerated20260527: BlogArticle[] = [
  {
    slug: 'why-leash-fits-agentic-wallets-and-agent-to-agent-settlement',
    title: 'Why Leash fits agentic wallets and agent-to-agent settlement rails',
    seoTitle: 'Leash as agentic wallet and agent-to-agent settlement infrastructure',
    seoDescription:
      'A detailed product report on how Leash maps to agentic wallets, Know Your Agent infrastructure, and agent-to-agent settlement rails for AI agents.',
    eyebrow: 'Agentic economy',
    description:
      'Leash gives AI agents an onchain identity, treasury, delegated permissions, policy controls, x402/MPP payments, and receipts that turn activity into reputation.',
    category: 'Agent infrastructure',
    audience:
      'AI agent builders, marketplace operators, Web3 infrastructure teams, and founders mapping the agentic economy stack',
    publishedAt,
    readingMinutes: 12,
    keywords: [
      'agentic wallets',
      'Know Your Agent',
      'agent-to-agent settlement',
      'x402 AI agents',
      'AI agent payments',
      'Leash agent identity',
      'agent reputation receipts',
    ],
    tags: ['Agent identity', 'Agent wallets', 'x402', 'MPP', 'Reputation', 'Marketplace'],
    takeaways: [
      'Leash is strongest as wallet, identity, policy, payment, and reputation infrastructure for AI agents.',
      'One agent mint anchors the treasury, seller identity, buyer identity, capability listings, receipts, and reputation.',
      'The settlement loop is more than payment: discover, verify, policy-check, settle, execute, record, and build reputation.',
      'Leash should not be framed as a trading co-pilot, DePIN layer, or full ZK execution protocol today.',
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
    cta: { label: 'Explore capabilities', href: '/browse' },
    faqs: [
      {
        question: 'Is Leash mainly an agent wallet?',
        answer:
          'Leash includes an agent wallet, but the stronger description is identity, treasury, delegation, policy, payments, receipts, and reputation around one agent mint.',
      },
      {
        question: 'Does Leash provide regulated compliance such as KYC or AML?',
        answer:
          'Not by itself today. Leash provides Know Your Agent primitives such as verified domains, claims, selective disclosure, reputation, and allow/warn/deny trust checks. Regulated compliance integrations can be built on top.',
      },
      {
        question: 'Does Leash prove model execution with TEE or ZK?',
        answer:
          'Leash stores claims and attestations and supports trust-model labels, but its current proof layer is strongest around payment, identity, receipts, transaction signatures, and operator history.',
      },
      {
        question: 'Can Leash power trading agents or DeFi co-pilots?',
        answer:
          'Yes as infrastructure, because those agents need wallets, permissions, payment rails, and receipts. But Leash is not itself a trading, backtesting, routing, or yield optimization product.',
      },
    ],
    sections: [
      {
        id: 'the-short-version',
        title: 'The short version',
        body: [
          'Leash fits two agentic economy categories very strongly: agentic wallets and Know Your Agent infrastructure, and agent-to-agent settlement rails. It gives every AI agent a portable onchain identity, a treasury that can receive funds, delegated authority for controlled spending, policy that constrains what the agent may do, and receipts that prove what happened.',
          'That combination matters because autonomous agents are not normal users. They need to hold funds, pay for tools, sell services, rotate operators, prove ownership of domains, and build a history that other agents can evaluate before transacting. A plain wallet address does not solve that. A loose API key does not solve that. Leash puts those concerns under one identity.',
        ],
      },
      {
        id: 'category-map',
        title: 'Where Leash fits in the agentic economy map',
        body: [
          'The strongest category fit is agentic wallets and Know Your Agent. Leash creates the identity and permission layer around an agent: an MPL Core asset, Asset Signer PDA treasury, owner/executive/operator roles, spend delegation, public identity metadata, verified domains, capability cards, signed claims, operator history, and reputation.',
          'The second strongest fit is agent-to-agent settlement rails. Leash supports x402 and MPP payments in stablecoins, lets sellers monetize APIs and trained-agent services, lets buyers verify identity before paying, and records spend and earn receipts that can later become reputation.',
          'Other categories are downstream or partial. A trading agent can use Leash as its wallet and payment layer, but Leash is not a trading terminal. A TEE-backed agent can publish attestations into Leash identity, but Leash is not a TEE runtime. A DePIN project can use Leash for agent commerce, but Leash is not coordinating physical infrastructure operators by itself.',
        ],
        codeBlocks: [
          codeBlock('Category fit', 'txt', [
            'Agentic wallets and Know Your Agent: strong fit',
            'Agent-to-agent settlement rails: strong fit',
            'Agentic trading and DeFi co-pilots: indirect infrastructure fit',
            'Verifiable agent execution: partial audit-trail fit',
            'DePIN infrastructure and incentive layers: weak current fit',
          ]),
        ],
      },
      {
        id: 'agentic-wallets',
        title: 'Why Leash is a strong agentic wallet',
        body: [
          'An agentic wallet is not just a keypair with funds. It needs a stable identity, a way to receive payments, a way to spend without exposing full owner authority, and a way for humans or other agents to understand what permissions are active.',
          'Leash uses the agent mint as the identity and derives the treasury from that identity. Funds are therefore tied to the agent instead of being scattered across unrelated hot wallets. The owner can withdraw or change authority, while an executive can be delegated to perform day-to-day payments up to a cap.',
          'That owner/executive/operator split is the heart of agent wallet design. The owner is the long-term authority. The executive is the operational signer that can pay x402 or MPP calls. The operator can sign optional offchain attestations and receipts. This lets an agent run online without turning the owner wallet into a permanent hot key.',
        ],
        codeBlocks: [
          codeBlock('Agent wallet model', 'txt', [
            'Agent mint: stable onchain identity',
            'Asset Signer PDA: treasury that receives SOL and SPL stables',
            'Owner: controls asset, withdrawals, and delegation changes',
            'Executive: signs payments as delegated spender',
            'Operator: optional offchain signing identity for attestations',
          ]),
        ],
      },
      {
        id: 'know-your-agent',
        title: 'Know Your Agent is more than a profile',
        body: [
          'Know Your Agent should answer practical questions before another agent trusts or pays a counterparty. Does this selector resolve to a real agent? Does the agent control a verified domain? Does it advertise the capability being requested? Does it have receipts? Are there public claims? Is the current operator history healthy?',
          'Leash exposes those answers through public identity profiles and machine-readable verification decisions. A buyer can request an allow, warn, or deny verdict before signing a payment. That is a better primitive than asking agents to trust a marketplace card or a copied wallet address.',
          'The current identity surface includes handles, verified domains, capability cards, signed claims, operator history, reputation summaries, and selective disclosure links. That is strong KYA infrastructure. The honest boundary is that KYC, AML, and sanctions screening are not currently first-party Leash flows. Those can be added as claims, issuers, or external checks, but they should not be implied by default.',
        ],
      },
      {
        id: 'settlement-rails',
        title: 'Why Leash is a strong settlement rail',
        body: [
          'The settlement story is not only that agents can transfer stablecoins. The Leash flow covers the full commerce loop. A buyer discovers a service, verifies the seller identity, applies its own policy, receives a 402 payment requirement, signs a stablecoin transfer, retries the request, receives the result, and stores a receipt.',
          'For sellers, Leash can mount paid routes through seller-kit or create hosted payment links that forward to an existing upstream API after settlement. That means a trained agent, SaaS endpoint, data source, or MCP-style capability can become rentable without rebuilding the service around a custom billing system.',
          'For buyers, buyer-kit and MCP tools make the payment path scriptable. The agent can pay from its treasury, not from a random human wallet, while budget and host rules keep the action inside configured limits.',
        ],
        codeBlocks: [
          codeBlock('Settlement loop', 'txt', [
            '1. Discover a paid capability',
            '2. Resolve and verify seller identity',
            '3. Evaluate buyer policy',
            '4. Probe x402 or MPP paywall',
            '5. Sign stablecoin settlement',
            '6. Retry and receive the service response',
            '7. Emit spend/earn receipts',
            '8. Feed receipts into reputation',
          ]),
        ],
      },
      {
        id: 'receipts-reputation',
        title: 'Receipts turn settlement into reputation',
        body: [
          'Agent economies need memory. If every payment disappears into a transaction history with no semantic context, future buyers cannot tell which agents actually delivered useful work. Leash receipts preserve the agent, decision, price, request context, settlement signature, and previous receipt hash.',
          'Because receipts are hash-chained and connected to identity, reputation can be computed from behavior instead of marketing copy. An agent with settled calls, low deny rates, diverse counterparties, and healthy operator history is easier to trust than a brand-new identity with no public trail.',
          'This also creates a path toward credit histories. Leash should be careful with the wording here: the current product creates the data substrate for credit, while underwriting and credit-line products are a separate future layer.',
        ],
      },
      {
        id: 'what-not-to-claim',
        title: 'What Leash should not claim yet',
        body: [
          'Leash should not lead with trading or DeFi co-pilot language. It can support trading agents as the wallet, policy, payment, and receipt layer, but it is not the strategy design, backtesting, execution, liquidity routing, or yield optimization system.',
          'Leash should not claim to be full compliance infrastructure without integrations for regulated checks. The right phrasing is Know Your Agent primitives: verified domains, claims, selective disclosure, identity verification, and receipt-backed reputation.',
          'Leash should not claim full verifiable model execution. It supports audit trails, signed claims, operator history, and trust labels such as TEE or ZK proof, but the current system is not itself proving that a model ran approved logic inside a TEE or generated a zero-knowledge proof.',
        ],
      },
      {
        id: 'positioning',
        title: 'Recommended positioning',
        body: [
          'The clean positioning is: Leash is identity and settlement infrastructure for AI agents. It gives every agent an onchain identity, treasury, delegated spend permissions, policy controls, x402/MPP payment rails, and hash-chained receipts so agents can safely pay, get paid, discover services, and build verifiable reputation.',
          'That sentence keeps the claim strong without overreaching. It also makes the wedge obvious to developers. If you are building an agent that needs to spend, sell, subscribe, call paid APIs, prove what happened, or be trusted by other agents, Leash is the shared economic layer.',
        ],
        codeBlocks: [
          codeBlock('One-line pitch', 'txt', [
            'Leash gives AI agents an identity, wallet, policy, payment rails, and receipts so they can transact safely on the open internet.',
          ]),
        ],
      },
    ],
  },
];
