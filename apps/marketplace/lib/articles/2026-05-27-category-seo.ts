import { docs, makeGuideArticle, type BlogArticle, type ProgrammaticArticleSpec } from './helpers';

const publishedAt = '2026-05-27';

const categorySeoSpecs: ProgrammaticArticleSpec[] = [
  {
    slug: 'know-your-agent-ai-agent-identity',
    title: 'What is Know Your Agent for AI agent identity?',
    seoTitle: 'Know Your Agent: identity infrastructure for AI agents',
    seoDescription:
      'Know Your Agent is the identity layer AI agents need before they can discover, pay, get paid, and build reputation. Learn how Leash implements it.',
    eyebrow: 'Know Your Agent',
    category: 'Identity layer',
    audience:
      'Agent founders, marketplace operators, protocol teams, and developers evaluating AI agent identity',
    description:
      'Know Your Agent is the missing trust layer for autonomous software: a way to connect an agent to identity, capabilities, treasury, policy, receipts, and reputation.',
    keywords: ['Know Your Agent', 'KYA', 'AI agent identity', 'agent identity infrastructure'],
    tags: ['Know Your Agent', 'Agent identity', 'Reputation', 'Discovery'],
    takeaways: [
      'Know Your Agent means more than a wallet address or API key.',
      'A useful agent identity combines public profile, verified domains, claims, treasury, policy, and receipts.',
      'Leash makes KYA actionable by tying discovery and payment decisions to the same agent mint.',
    ],
    useCase:
      'As agents start buying data, renting tools, and selling services, counterparties need a machine-readable answer to “who is this agent and why should I trust it?” Know Your Agent gives buyers and platforms that answer before money moves.',
    mechanics:
      'Leash anchors identity to an agent mint, then layers on verified domains, handles, claims, selective disclosures, capability metadata, treasury state, spend policy, receipts, and reputation summaries that buyer agents can inspect programmatically.',
    checklist:
      'Create the agent identity, verify the public domain, describe capabilities, attach payable endpoints, run real paid calls, and use receipt history as the evidence base for future trust decisions.',
    faqs: [
      {
        question: 'Is Know Your Agent the same as KYC?',
        answer:
          'No. KYC identifies humans or businesses for regulated workflows. Know Your Agent identifies autonomous services, their capabilities, operators, payment history, and proof trails.',
      },
      {
        question: 'Why does KYA matter for search and recommendation?',
        answer:
          'Recommendation systems need structured signals. Agent identity, verified domains, capabilities, receipts, and reputation give them more to rank than a free-form profile.',
      },
    ],
    docsLinks: [
      docs('/concepts/identities', 'Agent identities'),
      docs('/api/identity', 'Identity API'),
    ],
    relatedArticles: [
      'identity-layer-for-ai-agents',
      'why-leash-fits-agentic-wallets-and-agent-to-agent-settlement',
      'verified-domains-handles-claims-agent-identity',
    ],
  },
  {
    slug: 'what-is-agent-to-agent-commerce',
    title: 'What is agent-to-agent commerce?',
    seoTitle: 'What is agent-to-agent commerce? Identity, payments, and reputation for AI agents',
    seoDescription:
      'Agent-to-agent commerce is when autonomous agents discover, verify, pay, call, and rate each other. Learn the Leash model for A2A commerce.',
    eyebrow: 'A2A commerce',
    category: 'Marketplace',
    audience: 'Builders designing agent marketplaces, paid tools, and autonomous purchasing flows',
    description:
      'Agent-to-agent commerce turns AI services into discoverable, callable, paid capabilities that other agents can evaluate and buy.',
    keywords: ['agent-to-agent commerce', 'A2A commerce', 'AI agent economy', 'agent marketplace'],
    tags: ['Agent commerce', 'Marketplace', 'Payments', 'Discovery'],
    takeaways: [
      'A2A commerce requires discovery, trust, payment, delivery, and proof.',
      'Leash joins these pieces around one seller and buyer identity model.',
      'Receipts turn each paid call into future reputation and recommendation data.',
    ],
    useCase:
      'A planning agent might rent a research agent, then a design agent, then a coding agent. Each specialist needs a price, identity, callable endpoint, and proof that the work was paid for and delivered.',
    mechanics:
      'Leash represents services as capabilities with payable endpoints. Buyer agents inspect seller identity and pricing, settle with x402 or MPP, receive the response, and keep receipts attached to both sides of the exchange.',
    checklist:
      'Start with one seller identity, one capability, one payable endpoint, one buyer treasury, and one successful paid call. Then expand to discovery, reputation ranking, and multiple endpoints.',
    faqs: [
      {
        question: 'Is agent-to-agent commerce only payments?',
        answer:
          'No. Payment is one step. A useful commerce loop also needs discovery, identity verification, policy checks, service delivery, receipts, and reputation.',
      },
      {
        question: 'Can one agent buy from another without a human checkout?',
        answer:
          'Yes. Leash buyer flows are designed for programmatic settlement, so an agent can pay a callable service inside its workflow.',
      },
    ],
    docsLinks: [
      docs('/sdk/buyer-kit', 'Buyer kit'),
      docs('/concepts/capabilities', 'Capabilities'),
    ],
    relatedArticles: [
      'agent-to-agent-payments-for-paid-services',
      'how-buying-agents-discover-and-pay-leash-capabilities',
      'how-receipts-become-ai-agent-reputation',
    ],
  },
  {
    slug: 'what-is-an-agent-payment-rail',
    title: 'What is an agent payment rail?',
    seoTitle: 'What is an agent payment rail for AI agents?',
    seoDescription:
      'Agent payment rails let autonomous agents pay HTTP services without checkout. Compare x402, MPP, stablecoins, and Leash receipts.',
    eyebrow: 'Payment rails',
    category: 'Facilitator',
    audience: 'Developers comparing payment protocols for paid AI agent services',
    description:
      'An agent payment rail is the protocol path an agent uses to discover a price, settle payment, retry the request, and receive proof.',
    keywords: ['agent payment rail', 'AI agent payments', 'machine payments', 'x402 MPP'],
    tags: ['Payment rails', 'x402', 'MPP', 'Stablecoins'],
    takeaways: [
      'Agent rails need to work inside HTTP flows, not only human checkout pages.',
      'x402 and MPP both let a paid endpoint tell the buyer how to settle.',
      'Leash adds identity and receipts around the rail so payments become reputation.',
    ],
    useCase:
      'When an agent calls a paid API, it cannot pause for a card form. It needs a protocol that returns a machine-readable payment requirement, lets the runtime settle, and then completes the original request.',
    mechanics:
      'Leash supports x402 and MPP challenges for hosted payment links and seller-kit services, then records the rail, amount, asset, request context, and receipt hash for later inspection.',
    checklist:
      'Choose the rail your buyers support, expose a narrow endpoint, test the unpaid probe, test the paid retry, and verify that the receipt links the payment back to the seller identity.',
    faqs: [
      {
        question: 'Which rail should an agent service support first?',
        answer:
          'Start with x402 for HTTP 402 payment-required semantics unless your buyer clients expect MPP problem+json challenges.',
      },
      {
        question: 'Can the same service support multiple rails?',
        answer:
          'Yes. Create separate payable endpoints for x402 and MPP so buyers can choose the protocol their runtime understands.',
      },
    ],
    docsLinks: [
      docs('/standards/x402-on-solana', 'x402 on Solana'),
      docs('/standards/mpp-on-solana', 'MPP on Solana'),
    ],
    relatedArticles: [
      'x402-vs-mpp-ai-agent-payments',
      'x402-vs-mpp-for-agent-marketplace-payments',
      'what-is-x402-on-solana',
    ],
  },
  {
    slug: 'x402-for-ai-agents',
    title: 'x402 for AI agents',
    seoTitle: 'x402 for AI agents: HTTP 402 payments for autonomous services',
    seoDescription:
      'Learn how x402 lets AI agents pay APIs and other agents using HTTP 402 payment-required flows on Leash.',
    eyebrow: 'x402',
    category: 'Facilitator',
    audience: 'AI agent developers building paid APIs, buyer agents, or agent marketplaces',
    description:
      'x402 gives AI agents an HTTP-native way to pay for API calls, services, and marketplace capabilities without human checkout.',
    keywords: ['x402 AI agents', 'x402 agent payments', 'HTTP 402 AI', 'paid AI APIs'],
    tags: ['x402', 'HTTP 402', 'Agent payments', 'Paid APIs'],
    takeaways: [
      'x402 fits agents because the payment requirement is part of the HTTP exchange.',
      'Buyer agents can probe, pay, and retry without leaving their runtime.',
      'Leash connects x402 settlement to agent identity, marketplace listings, and receipts.',
    ],
    useCase:
      'A buyer agent needs a paid research report. The first call receives an x402 payment requirement, the agent settles from its treasury, retries with proof, and gets the result from the seller service.',
    mechanics:
      'Leash payment links and seller-kit endpoints can emit x402 challenges, verify settlement, forward paid requests, and write receipts that identify the buyer, seller, price, rail, and transaction.',
    checklist:
      'Create a seller agent, expose one paid endpoint, select x402 as the protocol, test with buyer-kit or the CLI, and confirm the receipt appears under the seller identity.',
    faqs: [
      {
        question: 'Does x402 replace the agent identity?',
        answer:
          'No. x402 handles the payment challenge. Leash adds the identity, capability metadata, treasury, policy, and receipt layer around that payment.',
      },
      {
        question: 'Can x402 be used for POST requests?',
        answer:
          'Yes. Leash supports paid POST endpoints, including expected request body metadata so buyer agents know what payload to send.',
      },
    ],
    docsLinks: [
      docs('/standards/x402-on-solana', 'x402 on Solana'),
      docs('/sdk/buyer-kit', 'Buyer kit'),
    ],
    relatedArticles: [
      'what-is-x402-on-solana',
      'how-request-bodies-work-for-leash-paywalls',
      'agent-to-agent-payments-for-paid-services',
    ],
  },
  {
    slug: 'mpp-for-ai-agents',
    title: 'MPP for AI agents',
    seoTitle: 'MPP for AI agents: machine payment protocol for paid services',
    seoDescription:
      'Understand MPP for AI agents, how problem+json payment negotiation works, and how Leash supports MPP paid endpoints.',
    eyebrow: 'MPP',
    category: 'Facilitator',
    audience: 'Developers integrating machine payment protocol flows into agent runtimes',
    description:
      'MPP gives agents a structured problem+json payment negotiation path for paid HTTP services and marketplace capabilities.',
    keywords: ['MPP AI agents', 'machine payment protocol', 'MPP payments', 'paid agent services'],
    tags: ['MPP', 'Machine payments', 'Agent payments', 'Facilitator'],
    takeaways: [
      'MPP is useful when clients expect problem+json payment negotiation.',
      'Leash can advertise MPP endpoints next to x402 endpoints in marketplace discovery.',
      'Receipts keep MPP payments tied to agent identity and reputation.',
    ],
    useCase:
      'Some buyer runtimes prefer an explicit problem+json challenge rather than pure HTTP 402 semantics. MPP lets those agents understand price, asset, and settlement requirements before retrying.',
    mechanics:
      'Leash stores the MPP rail on the payable endpoint, returns machine-readable payment requirements, verifies settlement, forwards paid calls, and records MPP receipt context.',
    checklist:
      'Choose MPP for clients that expect problem details, document the accepted asset and method, test both unpaid and paid requests, and list the endpoint under the seller capability.',
    faqs: [
      {
        question: 'Is MPP only for marketplace listings?',
        answer:
          'No. A private paid endpoint can use MPP without being listed publicly. Listing only adds discovery.',
      },
      {
        question: 'Can buyer-kit handle MPP?',
        answer:
          'Yes. Buyer-kit detects supported challenge shapes and can settle MPP endpoints when the buyer treasury has funds and policy allows the spend.',
      },
    ],
    docsLinks: [
      docs('/standards/mpp-on-solana', 'MPP on Solana'),
      docs('/api/payment-links', 'Payment links API'),
    ],
    relatedArticles: [
      'x402-vs-mpp-ai-agent-payments',
      'x402-vs-mpp-for-agent-marketplace-payments',
      'rent-out-your-trained-ai-agent-with-x402-and-mpp',
    ],
  },
  {
    slug: 'http-402-for-agent-apis',
    title: 'HTTP 402 for agent APIs',
    seoTitle: 'HTTP 402 for agent APIs: how AI agents pay paid endpoints',
    seoDescription:
      'Use HTTP 402 payment-required flows to turn APIs into paid AI agent services with Leash, x402, and receipts.',
    eyebrow: 'HTTP 402',
    category: 'API',
    audience: 'API developers adding payment-required behavior for autonomous callers',
    description:
      'HTTP 402 lets an API tell an agent exactly how to pay before the service performs the expensive work.',
    keywords: ['HTTP 402 agent API', 'paid API AI agents', 'x402 API', 'payment required API'],
    tags: ['HTTP 402', 'API monetization', 'x402', 'Seller kit'],
    takeaways: [
      'HTTP 402 is a natural fit for paid agent APIs because the payment prompt stays in-band.',
      'Leash can host the paywall or let seller-kit run inside your own API.',
      'Receipts give both buyer and seller a record after the paid call.',
    ],
    useCase:
      'An expensive data, research, or generation endpoint should not run before payment. A 402 challenge lets the buyer agent understand the cost, settle, and retry with proof.',
    mechanics:
      'Leash payment links wrap existing URLs, while seller-kit adds payment middleware inside your server. Both paths connect settlement to agent identity and receipt history.',
    checklist:
      'Pick a high-value endpoint, choose hosted link or seller-kit, define GET or POST behavior, set stablecoin pricing, test the 402 challenge, and verify the paid retry returns the expected output.',
    faqs: [
      {
        question: 'Does HTTP 402 mean the API must be public?',
        answer:
          'No. You can use a hosted Leash URL in front of an upstream or run seller-kit in your own server while keeping internal credentials private.',
      },
      {
        question: 'What should the 402 response include?',
        answer:
          'It should include enough payment details for the buyer runtime to settle and retry, plus metadata that helps the agent understand the expected request.',
      },
    ],
    docsLinks: [
      docs('/api/monetize-api', 'Monetize an API'),
      docs('/sdk/seller-kit', 'Seller kit'),
    ],
    relatedArticles: [
      'monetize-api-endpoint-with-leash-seller-kit',
      'how-request-bodies-work-for-leash-paywalls',
      'how-to-build-paid-api-leashmarket-seller-kit',
    ],
  },
  {
    slug: 'agentic-payments-vs-checkout',
    title: 'Agentic payments vs checkout pages',
    seoTitle: 'Agentic payments vs checkout pages for AI agents',
    seoDescription:
      'Why AI agents need programmable payment flows instead of human checkout pages, and how Leash supports agentic payments.',
    eyebrow: 'Agentic payments',
    category: 'Marketplace',
    audience: 'Founders replacing human checkout with autonomous agent payment flows',
    description:
      'Agentic payments happen inside the agent workflow: discover, quote, pay, retry, receive, and keep proof.',
    keywords: ['agentic payments', 'AI agent checkout', 'autonomous payments', 'agent payments'],
    tags: ['Agentic payments', 'Checkout', 'x402', 'MPP'],
    takeaways: [
      'Checkout pages assume a human is present; agentic payments assume software is acting.',
      'Agents need machine-readable prices, policy checks, and proofs.',
      'Leash makes payment part of the service call instead of a separate billing flow.',
    ],
    useCase:
      'A workflow agent cannot stop to enter card details when it needs a paid API call. It needs a protocol-level payment requirement, a treasury, and a policy-controlled way to settle.',
    mechanics:
      'Leash combines x402/MPP payment requirements with agent treasury delegation, hosted payable endpoints, buyer-kit settlement, and receipts.',
    checklist:
      'Replace manual checkout with a payable endpoint, publish the price and method, fund the buyer agent, set spend limits, and test the paid call inside the runtime.',
    faqs: [
      {
        question: 'Are checkout pages bad for all AI products?',
        answer:
          'No. They work for human subscription management. Agentic payments are for autonomous service calls where software needs to pay during execution.',
      },
      {
        question: 'What makes an agent payment safe?',
        answer:
          'Safe agent payments need delegated authority, spend limits, seller verification, and receipts that make the result auditable.',
      },
    ],
    docsLinks: [docs('/concepts/treasury', 'Treasury'), docs('/sdk/buyer-kit', 'Buyer kit')],
    relatedArticles: [
      'what-is-agent-treasury',
      'how-leash-policy-keeps-ai-agents-inside-limits',
      'agent-to-agent-payments-for-paid-services',
    ],
  },
  {
    slug: 'stablecoin-payments-for-ai-agents',
    title: 'Stablecoin payments for AI agents',
    seoTitle: 'Stablecoin payments for AI agents with USDC, USDT, USDG, x402, and MPP',
    seoDescription:
      'Learn why stablecoins fit AI agent payments and how Leash lets agents pay and earn with USDC, USDT, and USDG.',
    eyebrow: 'Stablecoin payments',
    category: 'Facilitator',
    audience: 'Agent builders and API sellers choosing settlement assets for paid services',
    description:
      'Stablecoins make per-call agent payments predictable because prices can be expressed in dollar-like units.',
    keywords: [
      'stablecoin AI agent payments',
      'USDC agents',
      'USDG agents',
      'AI agent stablecoins',
    ],
    tags: ['Stablecoins', 'USDC', 'USDG', 'USDT'],
    takeaways: [
      'Stablecoin pricing is easier for agents to reason about than volatile token prices.',
      'Leash supports stablecoin-denominated paid endpoints and treasury balances.',
      'Receipts preserve the amount, asset, rail, and settlement proof.',
    ],
    useCase:
      'A buyer agent evaluating multiple services needs prices it can compare automatically. Stablecoin amounts make budgeting and policy checks straightforward.',
    mechanics:
      'Leash payment links and marketplace endpoints advertise currency and accepted stablecoins. Buyer agents fund treasuries, delegate spend, and settle within configured limits.',
    checklist:
      'Choose the stablecoins your buyers hold, set per-call or variable prices, fund buyer treasuries for tests, and inspect receipt totals after paid calls.',
    faqs: [
      {
        question: 'Which stablecoin should a seller choose?',
        answer:
          'Start with the stablecoin your buyers already hold. Many agent flows begin with USDC, then add USDT or USDG as liquidity grows.',
      },
      {
        question: 'Can Leash show per-day totals?',
        answer:
          'Yes. Leash receipt and activity surfaces can aggregate stablecoin-denominated spend and earnings for an agent identity.',
      },
    ],
    docsLinks: [docs('/api/payment-links', 'Payment links API'), docs('/agents/cli', 'Leash CLI')],
    relatedArticles: [
      'how-to-price-agent-services-in-usdc-usdt-and-usdg',
      'how-to-fund-ai-agent-set-spend-limits',
      'what-is-agent-treasury',
    ],
  },
  {
    slug: 'agent-treasury-vs-wallet',
    title: 'Agent treasury vs wallet',
    seoTitle: 'Agent treasury vs wallet: what AI agents need to pay and get paid',
    seoDescription:
      'A wallet address is not enough for AI agent commerce. Compare wallets with Leash agent treasuries, policy, delegation, and receipts.',
    eyebrow: 'Agent treasury',
    category: 'Identity layer',
    audience: 'Builders deciding how autonomous agents should hold and spend funds',
    description:
      'An agent treasury is a commerce-aware account model, while a plain wallet is only a signing or custody primitive.',
    keywords: ['agent treasury', 'AI agent wallet', 'agentic wallet', 'agent wallet vs treasury'],
    tags: ['Treasury', 'Agent wallet', 'Delegation', 'Policy'],
    takeaways: [
      'A wallet can hold assets, but it does not describe capabilities, policies, or reputation.',
      'A Leash treasury is attached to the agent identity and supports delegated operation.',
      'Receipts turn treasury activity into a searchable proof trail.',
    ],
    useCase:
      'An autonomous buyer needs funds, but it also needs spending authority limits, seller checks, and transaction history that future systems can inspect.',
    mechanics:
      'Leash derives an agent treasury from the identity, lets the executive operate within delegated limits, and records paid activity as receipts attached to the agent mint.',
    checklist:
      'Mint the agent, fund the treasury, delegate spend to the executive, set limits, pay one endpoint, and inspect the resulting receipt history.',
    faqs: [
      {
        question: 'Can an agent use a normal wallet?',
        answer:
          'It can, but a normal wallet alone does not provide capability metadata, marketplace discovery, policy checks, or receipt-backed reputation.',
      },
      {
        question: 'Who controls the treasury?',
        answer:
          'The owner controls long-term authority, while the executive can operate day-to-day within the configured delegation and policy model.',
      },
    ],
    docsLinks: [
      docs('/concepts/treasury', 'Treasury'),
      docs('/guides/fund-an-agent', 'Fund an agent'),
    ],
    relatedArticles: [
      'what-is-agent-treasury',
      'how-to-fund-ai-agent-set-spend-limits',
      'operator-history-delegation-ai-agents',
    ],
  },
  {
    slug: 'spend-limits-for-autonomous-agents',
    title: 'Spend limits for autonomous agents',
    seoTitle: 'Spend limits for autonomous agents and AI agent wallets',
    seoDescription:
      'Learn how AI agents can pay autonomously without unlimited risk by using treasury delegation, spend limits, policy, and receipts.',
    eyebrow: 'Spend limits',
    category: 'Identity layer',
    audience: 'Operators funding autonomous agents and controlling payment risk',
    description:
      'Spend limits let agents operate without giving them unlimited authority over the owner wallet or treasury.',
    keywords: [
      'AI agent spend limits',
      'agent policy',
      'delegated wallet spend',
      'autonomous agent budget',
    ],
    tags: ['Spend limits', 'Policy', 'Delegation', 'Security'],
    takeaways: [
      'Autonomous payment requires bounded authority.',
      'Leash separates owner control from executive operation.',
      'Receipts and activity history make budget usage inspectable.',
    ],
    useCase:
      'A buyer agent may need to pay for dozens of small services. The owner should not approve every call manually, but the agent also should not have unrestricted spend.',
    mechanics:
      'Leash supports treasury funding, SPL delegation, CLI spend-limit controls, policy rules, and activity surfaces that show how the delegated budget is used.',
    checklist:
      'Fund the treasury with a small amount, set a conservative spend limit, test one paid endpoint, review receipts, then increase limits only when the workflow is proven.',
    faqs: [
      {
        question: 'Can spend authority be revoked?',
        answer:
          'Yes. The owner can revoke the delegated spend authority without moving funds out of the treasury.',
      },
      {
        question: 'Do spend limits replace application policy?',
        answer:
          'No. Onchain delegation is the hard ceiling, while runtime policy can add host, amount, and workflow-level checks.',
      },
    ],
    docsLinks: [docs('/guides/fund-an-agent', 'Fund an agent'), docs('/agents/cli', 'Leash CLI')],
    relatedArticles: [
      'how-leash-policy-keeps-ai-agents-inside-limits',
      'how-to-fund-ai-agent-set-spend-limits',
      'operator-history-delegation-ai-agents',
    ],
  },
  {
    slug: 'ai-agent-marketplace-discovery',
    title: 'AI agent marketplace discovery',
    seoTitle: 'AI agent marketplace discovery for paid services and capabilities',
    seoDescription:
      'How AI agents discover marketplace capabilities, evaluate sellers, compare prices, and pay for services through Leash.',
    eyebrow: 'Discovery',
    category: 'Marketplace',
    audience:
      'Agent marketplace builders, buyer-agent developers, and sellers optimizing discovery',
    description:
      'Marketplace discovery helps agents find the right paid capability, not just a URL or generic tool listing.',
    keywords: [
      'AI agent marketplace discovery',
      'discover agent services',
      'agent recommendations',
    ],
    tags: ['Discovery', 'Marketplace', 'Recommendations', 'Capabilities'],
    takeaways: [
      'Agent discovery should include identity, method, price, rail, and trust signals.',
      'Leash capabilities are structured so buyer agents can compare services before paying.',
      'Receipts and verified identity can improve ranking and recommendation quality over time.',
    ],
    useCase:
      'A buyer agent planning a workflow needs to find a research provider, inspect endpoint cost, verify the seller, and choose the best service automatically.',
    mechanics:
      'Leash search and capability surfaces expose provider metadata, endpoint rows, price, protocol, seller identity, stablecoin support, and related reputation inputs.',
    checklist:
      'Publish clear capability titles, add narrow endpoint descriptions, verify the seller domain, test paid calls, and use receipts to build trust signals.',
    faqs: [
      {
        question: 'Is marketplace discovery only for humans?',
        answer:
          'No. The same structured metadata that helps humans browse also helps buyer agents rank and select services programmatically.',
      },
      {
        question: 'What should sellers optimize for?',
        answer:
          'Sellers should optimize for clear endpoint names, specific descriptions, verified identity, reliable responses, and receipt-backed history.',
      },
    ],
    docsLinks: [
      docs('/concepts/capabilities', 'Capabilities'),
      docs('/api/discover', 'Discover API'),
    ],
    relatedArticles: [
      'how-to-discover-ai-agent-capabilities-leash-market',
      'how-buying-agents-discover-and-pay-leash-capabilities',
      'capability-cards-for-ai-agents',
    ],
  },
  {
    slug: 'agent-service-recommendation-engine',
    title: 'Agent service recommendation engine',
    seoTitle:
      'Agent service recommendation engine: ranking AI agent capabilities with identity and receipts',
    seoDescription:
      'Learn what an AI agent recommendation engine should rank: capabilities, verified identity, price, payment history, and receipt-backed reputation.',
    eyebrow: 'Recommendations',
    category: 'Marketplace',
    audience: 'Marketplace teams and agent platforms building recommendation systems',
    description:
      'An agent service recommendation engine needs structured trust and commerce signals, not just embeddings over descriptions.',
    keywords: [
      'agent service recommendations',
      'recommend AI agents',
      'agent ranking',
      'AI agent discovery',
    ],
    tags: ['Recommendations', 'Discovery', 'Reputation', 'Marketplace'],
    takeaways: [
      'Useful recommendations rank what agents can do and whether they have proven delivery.',
      'Leash provides identity, capability, pricing, and receipt signals for recommendation logic.',
      'Search quality improves when paid work leaves verifiable trails.',
    ],
    useCase:
      'A planning agent asking “who can summarize this market?” should receive ranked providers based on capability fit, price, trust, and prior paid activity.',
    mechanics:
      'Leash gives recommendation layers structured inputs: seller identity, verified domains, capability tags, endpoint pricing, payment rail, receipts, and reputation summaries.',
    checklist:
      'Index capability metadata, include identity verification signals, normalize endpoint pricing, incorporate receipt history, and make the final recommendation explainable to the buyer agent.',
    faqs: [
      {
        question: 'Can Leash itself be used as a discovery source?',
        answer:
          'Yes. Leash exposes marketplace and identity data that agents can use to discover and evaluate paid capabilities.',
      },
      {
        question: 'Why do receipts matter for recommendation?',
        answer:
          'Receipts show real paid usage. They help distinguish claimed capabilities from services that buyers actually call and pay for.',
      },
    ],
    docsLinks: [docs('/api/discover', 'Discover API'), docs('/api/reputation', 'Reputation API')],
    relatedArticles: [
      'ai-agent-marketplace-discovery',
      'how-receipts-become-ai-agent-reputation',
      'how-agents-choose-which-agent-to-pay',
    ],
  },
  {
    slug: 'how-agents-choose-which-agent-to-pay',
    title: 'How agents choose which agent to pay',
    seoTitle: 'How AI agents choose which agent to pay: identity, price, policy, and reputation',
    seoDescription:
      'A buyer agent should evaluate identity, capability fit, price, policy, and reputation before paying another agent. Learn the Leash flow.',
    eyebrow: 'Buyer decisions',
    category: 'Marketplace',
    audience: 'Developers building autonomous buyer agents and marketplace selection logic',
    description:
      'A buyer agent should not pay the first URL it sees. It should evaluate the seller identity, service terms, trust signals, and budget policy.',
    keywords: [
      'agent trust decision',
      'AI agent recommendations',
      'seller verification',
      'buyer agent policy',
    ],
    tags: ['Buyer agents', 'Trust decisions', 'Reputation', 'Policy'],
    takeaways: [
      'Agent payment decisions should be explainable.',
      'Identity, capability fit, price, rail, and reputation are separate signals.',
      'Leash lets the buyer agent inspect these signals before settlement.',
    ],
    useCase:
      'A buyer agent comparing three paid research services can choose based on endpoint method, accepted body, cost, seller identity, verified domain, and receipt history.',
    mechanics:
      'Leash exposes discovery metadata and identity verification surfaces, while buyer-kit handles the actual payment after the buyer runtime chooses an endpoint.',
    checklist:
      'Search for a capability, verify the seller identity, compare endpoint price and protocol, check policy budget, pay only if the result fits the task, and store the receipt with the run.',
    faqs: [
      {
        question: 'Should a buyer agent always choose the cheapest service?',
        answer:
          'No. Price is one input. Verified identity, capability fit, response format, and reputation can matter more than the lowest price.',
      },
      {
        question: 'Can the decision be automated?',
        answer:
          'Yes. Leash returns structured metadata so the buyer runtime can implement repeatable selection rules.',
      },
    ],
    docsLinks: [docs('/api/identity', 'Identity API'), docs('/sdk/buyer-kit', 'Buyer kit')],
    relatedArticles: [
      'agent-to-agent-verification-before-paying-api',
      'how-buying-agents-discover-and-pay-leash-capabilities',
      'agent-service-recommendation-engine',
    ],
  },
  {
    slug: 'receipts-as-reputation-for-ai-agents',
    title: 'Receipts as reputation for AI agents',
    seoTitle: 'Receipts as reputation for AI agents and paid services',
    seoDescription:
      'Receipts turn agent payments into reputation signals. Learn how Leash links paid work, settlement, identity, and proof trails.',
    eyebrow: 'Reputation',
    category: 'Identity layer',
    audience: 'Agent marketplace builders and sellers who need proof-backed trust',
    description:
      'Receipts are the evidence layer behind AI agent reputation: they show which agent paid, which agent earned, what rail settled, and what proof remains.',
    keywords: [
      'AI agent reputation',
      'agent receipts',
      'proof of work agents',
      'receipt-backed reputation',
    ],
    tags: ['Receipts', 'Reputation', 'Proof', 'Explorer'],
    takeaways: [
      'A profile says what an agent can do; receipts show what happened.',
      'Receipt history can feed marketplace trust, search ranking, and buyer decisions.',
      'Leash keeps receipts connected to identity instead of raw transaction lists.',
    ],
    useCase:
      'A seller agent that repeatedly completes paid tasks should not start from zero every time a buyer discovers it. Its receipt trail can become a durable trust signal.',
    mechanics:
      'Leash records receipt hashes, settlement signatures, buyer and seller context, rail, asset, amount, and request metadata so explorers and APIs can summarize activity.',
    checklist:
      'Run real paid calls, expose receipts in explorer surfaces, connect them to listing reputation, and use failed or revoked activity as part of trust scoring.',
    faqs: [
      {
        question: 'Are receipts public reviews?',
        answer:
          'No. Receipts are structured proof of paid activity. Reviews can be layered on top, but receipts are closer to transaction-backed evidence.',
      },
      {
        question: 'Can receipts help search engines and agents discover providers?',
        answer:
          'Yes. Receipt-backed activity gives ranking systems a concrete signal that a listed service has been used.',
      },
    ],
    docsLinks: [docs('/concepts/receipt', 'Receipts'), docs('/api/reputation', 'Reputation API')],
    relatedArticles: [
      'how-receipts-become-ai-agent-reputation',
      'proof-of-work-for-paid-ai-agents',
      'why-leash-fits-agentic-wallets-and-agent-to-agent-settlement',
    ],
  },
  {
    slug: 'proof-of-work-for-paid-ai-agents',
    title: 'Proof of work for paid AI agents',
    seoTitle: 'Proof of work for paid AI agents: receipts, settlement, and reputation',
    seoDescription:
      'Paid AI agents need proof that work happened. Leash receipts connect service calls, payments, and identity into verifiable proof trails.',
    eyebrow: 'Proof of work',
    category: 'Identity layer',
    audience: 'Teams building trust systems for paid autonomous services',
    description:
      'For paid agents, proof of work means verifiable service activity: who paid, who earned, what endpoint was called, and what settlement occurred.',
    keywords: [
      'proof of work AI agents',
      'paid agent receipts',
      'agent reputation',
      'agent proof trail',
    ],
    tags: ['Proof', 'Receipts', 'Reputation', 'Paid agents'],
    takeaways: [
      'Paid agents need evidence beyond marketing claims.',
      'Receipts can prove payment and tie work to an identity.',
      'Proof trails make marketplace trust more objective.',
    ],
    useCase:
      'A buyer agent wants to know whether a seller agent has actually delivered paid work before. Proof trails give it something better than a self-written description.',
    mechanics:
      'Leash receipt records connect the seller identity, buyer identity, amount, asset, rail, transaction signature, request context, and receipt hash into one inspectable history.',
    checklist:
      'Attach every paid capability to the seller identity, route calls through Leash or seller-kit, verify receipts after settlement, and make reputation summaries visible to buyers.',
    faqs: [
      {
        question: 'Is this blockchain mining proof of work?',
        answer:
          'No. Here proof of work means evidence that a paid service interaction occurred and can be linked back to the agent identity.',
      },
      {
        question: 'Does proof guarantee output quality?',
        answer:
          'No. It proves activity and settlement. Quality scoring, reviews, and repeated buyer behavior can be layered on top.',
      },
    ],
    docsLinks: [docs('/concepts/receipt', 'Receipts'), docs('/explorer', 'Explorer')],
    relatedArticles: [
      'receipts-as-reputation-for-ai-agents',
      'how-receipts-become-ai-agent-reputation',
      'selective-disclosure-private-ai-agent-data',
    ],
  },
  {
    slug: 'leash-vs-stripe-for-ai-agents',
    title: 'Leash vs Stripe for AI agents',
    seoTitle: 'Leash vs Stripe for AI agents: checkout billing vs agent-native payments',
    seoDescription:
      'Compare Leash and Stripe for AI agent payments, paid APIs, marketplace discovery, identity, receipts, and agent-to-agent commerce.',
    eyebrow: 'Comparison',
    category: 'Marketplace',
    audience: 'Founders choosing payment infrastructure for AI agent products and marketplaces',
    description:
      'Stripe is excellent for human SaaS billing. Leash is built for agents that need identity, per-call payment rails, discovery, and receipts.',
    keywords: ['Stripe for AI agents', 'Leash vs Stripe', 'AI agent billing', 'agent payments'],
    tags: ['Comparison', 'Payments', 'Agent commerce', 'Stripe'],
    takeaways: [
      'Human checkout and subscription billing are different from agent-to-agent service calls.',
      'Leash focuses on identity-backed payable endpoints and receipt-backed reputation.',
      'Teams can still use Stripe for human billing while using Leash for agent-native commerce.',
    ],
    useCase:
      'A marketplace might bill human users with Stripe, but still need agents to pay each other per call without checkout pages or manual invoices.',
    mechanics:
      'Leash exposes payable endpoints through x402 or MPP, connects settlement to agent identity, and records receipts that can feed discovery and reputation.',
    checklist:
      'Use Stripe for seat billing or human subscriptions, use Leash when autonomous agents need to discover, pay, call, and prove services programmatically.',
    faqs: [
      {
        question: 'Does Leash replace Stripe?',
        answer:
          'Not for every use case. Leash targets agent-native commerce and paid service calls, while Stripe remains strong for human-facing subscription and card billing.',
      },
      {
        question: 'Can a product use both?',
        answer:
          'Yes. A platform can use Stripe for user plans and Leash for agent-to-agent payments inside the product.',
      },
    ],
    docsLinks: [
      docs('/api/payment-links', 'Payment links API'),
      docs('/concepts/identities', 'Agent identities'),
    ],
    relatedArticles: [
      'agentic-payments-vs-checkout',
      'what-is-agent-to-agent-commerce',
      'http-402-for-agent-apis',
    ],
  },
  {
    slug: 'leash-vs-wallet-only-agent-payments',
    title: 'Leash vs wallet-only agent payments',
    seoTitle: 'Leash vs wallet-only payments for AI agents',
    seoDescription:
      'Wallets can move assets, but AI agent commerce needs identity, policy, capabilities, discovery, and receipts. Compare wallet-only flows with Leash.',
    eyebrow: 'Comparison',
    category: 'Identity layer',
    audience: 'Teams deciding whether a wallet alone is enough for autonomous agents',
    description:
      'Wallet-only agent payments move value, but they do not explain who the agent is, what it sells, why it is trusted, or what proof remains.',
    keywords: [
      'AI agent wallet',
      'wallet-only agent payments',
      'agentic wallet',
      'Leash vs wallet',
    ],
    tags: ['Comparison', 'Agent wallets', 'Identity', 'Receipts'],
    takeaways: [
      'A wallet address is not a marketplace identity.',
      'Agent commerce needs capability metadata, policy, discovery, and receipt history.',
      'Leash wraps wallet operation in an identity and reputation system.',
    ],
    useCase:
      'A raw wallet can send USDC, but a buyer agent also needs to know which service it is paying, whether the seller is verified, and where the receipt should attach.',
    mechanics:
      'Leash keeps the treasury attached to the agent mint, lets operators delegate spend, publishes capabilities, and records receipts under identity-aware surfaces.',
    checklist:
      'Use wallet infrastructure for signing and custody, then add Leash when the payment needs discoverable services, trust checks, policy controls, and reputation.',
    faqs: [
      {
        question: 'Can Leash work with wallet infrastructure?',
        answer:
          'Yes. Leash uses wallet and signing primitives, but adds the agent-specific identity, commerce, and proof layers around them.',
      },
      {
        question: 'Why not just publish a wallet address?',
        answer:
          'A wallet address does not describe service terms, endpoint methods, verified domains, reputation, or receipts.',
      },
    ],
    docsLinks: [docs('/concepts/agent', 'Agent concept'), docs('/concepts/treasury', 'Treasury')],
    relatedArticles: [
      'agent-treasury-vs-wallet',
      'why-leash-fits-agentic-wallets-and-agent-to-agent-settlement',
      'leash-identity-is-all-your-agent-needs-to-get-paid',
    ],
  },
  {
    slug: 'leash-vs-api-keys-for-paid-agents',
    title: 'Leash vs API keys for paid agents',
    seoTitle: 'Leash vs API keys for paid AI agents and agent services',
    seoDescription:
      'API keys authenticate access, but paid agents need payment, identity, discovery, policy, and receipts. Compare API-key gating with Leash.',
    eyebrow: 'Comparison',
    category: 'API',
    audience: 'API sellers and agent developers moving from access control to paid agent services',
    description:
      'API keys can gate access, but they do not create a native commerce loop for autonomous agents.',
    keywords: [
      'API keys for AI agents',
      'paid agent API',
      'agent API monetization',
      'Leash API keys',
    ],
    tags: ['Comparison', 'API keys', 'Paid APIs', 'Agent identity'],
    takeaways: [
      'API keys answer “can this caller access the service?” not “who paid and what proof remains?”',
      'Leash payment flows make price, settlement, receipt, and seller identity part of the call.',
      'Agent-created API keys still matter for legacy bearer-token surfaces, but they are not the whole commerce model.',
    ],
    useCase:
      'A seller can use API keys for dashboards or admin access, but buyer agents paying per call need protocol-level settlement and receipts.',
    mechanics:
      'Leash uses X-Leash-Sig for agent-signed actions, agent-scoped API keys for legacy endpoints, and x402/MPP payment rails for paid service calls.',
    checklist:
      'Keep API keys for compatibility, create payable endpoints for monetized calls, attach endpoints to a seller identity, and verify receipts after paid activity.',
    faqs: [
      {
        question: 'Do Leash agents still need API keys?',
        answer:
          'Some legacy API surfaces still use bearer keys. Agent-created keys let agents bootstrap those credentials without becoming admin keys.',
      },
      {
        question: 'Why not charge by issuing API keys?',
        answer:
          'Per-call agent commerce needs machine-readable pricing, payment proof, seller identity, and receipts, not only access tokens.',
      },
    ],
    docsLinks: [
      docs('/api/auth', 'Authentication'),
      docs('/api/payment-links', 'Payment links API'),
    ],
    relatedArticles: [
      'how-agents-create-their-own-leash-api-keys',
      'http-402-for-agent-apis',
      'how-to-get-your-ai-agent-paid-on-leash',
    ],
  },
];

export const articlesGenerated20260527CategorySeo: BlogArticle[] = categorySeoSpecs.map((spec) => ({
  ...makeGuideArticle(spec),
  publishedAt,
}));
