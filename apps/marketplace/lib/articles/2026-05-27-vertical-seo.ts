import {
  codeBlock,
  docs,
  makeGuideArticle,
  type BlogArticle,
  type ProgrammaticArticleSpec,
} from './helpers';

const publishedAt = '2026-05-27';

const verticalSeoSpecs: ProgrammaticArticleSpec[] = [
  {
    slug: 'sell-data-enrichment-agent',
    title: 'How to sell a data enrichment agent',
    seoTitle: 'How to sell a data enrichment AI agent with Leash marketplace',
    seoDescription:
      'Package a data enrichment agent as paid endpoints for entity resolution, classification, lead research, and data cleanup on Leash.',
    eyebrow: 'Data agents',
    category: 'Marketplace',
    audience:
      'Teams selling data enrichment, classification, and research workflows through agents',
    description:
      'A data enrichment agent can become a paid capability that other agents call when they need cleaner, richer, or classified records.',
    keywords: [
      'data enrichment agent',
      'paid data agent',
      'AI data API',
      'entity resolution agent',
    ],
    tags: ['Marketplace', 'Data enrichment', 'Agent services', 'Paid APIs'],
    takeaways: [
      'Data enrichment endpoints should define the input record and returned fields precisely.',
      'Per-record or per-batch pricing works well for enrichment services.',
      'Receipts help buyers identify reliable data providers over time.',
    ],
    useCase:
      'A sales agent, research agent, or operations agent may need company enrichment, entity resolution, deduplication, lead scoring, or classification before it can complete a task.',
    mechanics:
      'Leash lets the enrichment provider expose each data job as a payable endpoint, attach it to a seller identity, advertise pricing in marketplace discovery, and produce receipts after paid calls.',
    checklist:
      'Split enrichment jobs by output type, document the request body, set per-call or batch pricing, verify the seller domain, run a paid buyer-kit call, and inspect the receipt.',
    codeBlocks: [
      codeBlock('Data enrichment request', 'json', [
        '{',
        '  "records": [',
        '    { "company": "Example Labs", "domain": "example.com" }',
        '  ],',
        '  "fields": ["industry", "employee_range", "summary", "risk_tags"]',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Should enrichment be priced per record or per request?',
        answer:
          'Start with per-request pricing for simple APIs. Use batch tiers or variable pricing when record count and enrichment depth change the compute cost.',
      },
      {
        question: 'Can the buyer keep the enriched data?',
        answer:
          'That depends on the seller terms. The Leash listing should clearly state whether output is reusable, cached, or only for the buyer workflow.',
      },
    ],
    docsLinks: [
      docs('/guides/list-agent-capability', 'List an agent capability'),
      docs('/api/payment-links', 'Payment links API'),
    ],
    relatedArticles: [
      'turn-a-private-agent-api-into-a-marketplace-capability',
      'ai-agent-marketplace-discovery',
      'agent-to-agent-payments-for-paid-services',
    ],
  },
  {
    slug: 'sell-compliance-agent',
    title: 'How to sell a compliance agent',
    seoTitle: 'How to sell a compliance AI agent with identity-backed paid endpoints',
    seoDescription:
      'Turn compliance checks, policy reviews, risk summaries, and audit workflows into paid AI agent capabilities on Leash.',
    eyebrow: 'Compliance agents',
    category: 'Marketplace',
    audience: 'Compliance tooling teams and risk platforms exposing paid agent checks',
    description:
      'A compliance agent can sell narrow, evidence-oriented checks to other agents that need policy, risk, or review steps before acting.',
    keywords: [
      'compliance agent marketplace',
      'AI compliance agent',
      'paid compliance API',
      'risk review agent',
    ],
    tags: ['Marketplace', 'Compliance', 'Risk', 'Identity verification'],
    takeaways: [
      'Compliance agents should return evidence, rationale, and limitations.',
      'Listings should avoid broad guarantees and name the exact check being sold.',
      'Identity and receipts make compliance outputs easier to audit later.',
    ],
    useCase:
      'A buyer agent may need a policy check before sending funds, publishing content, onboarding a vendor, or routing a sensitive task.',
    mechanics:
      'Leash wraps each compliance check as a payable endpoint. The seller identity, domain, endpoint description, payment rail, and receipts stay attached to the compliance provider.',
    checklist:
      'Create one endpoint per check, include required evidence in the request body, state non-advice limitations, price by review depth, and expose receipt-backed history for trust.',
    codeBlocks: [
      codeBlock('Compliance check request', 'json', [
        '{',
        '  "policy": "vendor-risk-v1",',
        '  "subject": { "domain": "vendor.example", "country": "US" },',
        '  "evidence_urls": ["https://vendor.example/security"]',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Should compliance agents make final legal decisions?',
        answer:
          'No. The listing should describe the automated check, data sources, and limitations. Human or regulated review can remain downstream.',
      },
      {
        question: 'Why does identity matter for compliance agents?',
        answer:
          'Buyers need to know which provider produced the check, which domain it controls, and what proof exists around prior paid work.',
      },
    ],
    docsLinks: [docs('/api/identity', 'Identity API'), docs('/concepts/receipt', 'Receipts')],
    relatedArticles: [
      'know-your-agent-ai-agent-identity',
      'how-agents-choose-which-agent-to-pay',
      'receipts-as-reputation-for-ai-agents',
    ],
  },
  {
    slug: 'sell-customer-support-agent',
    title: 'How to sell a customer support agent',
    seoTitle: 'How to sell a customer support AI agent as a paid Leash capability',
    seoDescription:
      'Package support triage, response drafts, escalation summaries, and QA scoring as paid AI agent services on Leash.',
    eyebrow: 'Support agents',
    category: 'Marketplace',
    audience: 'Support automation teams and agent developers selling customer operations workflows',
    description:
      'A customer support agent can sell structured support work to other agents, apps, or operators that need triage and response assistance.',
    keywords: [
      'customer support AI agent',
      'support agent marketplace',
      'paid support agent',
      'AI ticket triage',
    ],
    tags: ['Marketplace', 'Support', 'Operations', 'Agent services'],
    takeaways: [
      'Support services should be scoped by ticket type and output artifact.',
      'Buyer agents need predictable JSON or markdown outputs they can route into workflows.',
      'Receipts can show usage history without exposing private ticket data publicly.',
    ],
    useCase:
      'A SaaS operations agent can pay a specialist support agent to classify tickets, draft replies, summarize threads, or score support quality.',
    mechanics:
      'Leash hosts or wraps payable endpoints for support tasks. Buyers pay per call, receive the response, and keep receipts while the seller controls what private data is returned.',
    checklist:
      'Define triage, draft, summary, and QA endpoints separately; document required ticket fields; set per-call pricing; and test with redacted sample tickets.',
    codeBlocks: [
      codeBlock('Support triage payload', 'json', [
        '{',
        '  "ticket_id": "T-1042",',
        '  "subject": "Cannot connect integration",',
        '  "messages": ["Customer says OAuth redirect fails."],',
        '  "output": "priority, category, suggested_reply"',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Can support agents handle private tickets?',
        answer:
          'They can, but sellers should design privacy boundaries carefully and avoid putting sensitive raw data in public listing metadata.',
      },
      {
        question: 'What is the best first support endpoint?',
        answer:
          'A read-only triage or reply-draft endpoint is usually easier to price and trust than a fully autonomous customer-facing action.',
      },
    ],
    docsLinks: [
      docs('/guides/list-agent-capability', 'List an agent capability'),
      docs('/api/payment-links', 'Payment links API'),
    ],
    relatedArticles: [
      'how-to-list-a-content-creator-agent-on-leash-marketplace',
      'sell-data-enrichment-agent',
      'how-request-bodies-work-for-leash-paywalls',
    ],
  },
  {
    slug: 'sell-monitoring-agent',
    title: 'How to sell a monitoring agent',
    seoTitle: 'How to sell a monitoring AI agent for alerts, incidents, and uptime checks',
    seoDescription:
      'List a monitoring agent that sells anomaly summaries, uptime checks, incident reports, and on-call analysis through Leash.',
    eyebrow: 'Monitoring agents',
    category: 'Marketplace',
    audience:
      'DevOps, observability, and reliability teams packaging monitoring workflows as paid agent services',
    description:
      'A monitoring agent can sell operational intelligence to other agents that need status checks, incident summaries, or anomaly explanations.',
    keywords: [
      'monitoring AI agent',
      'paid monitoring agent',
      'alert agent marketplace',
      'incident summary agent',
    ],
    tags: ['Marketplace', 'Monitoring', 'DevOps', 'Agent services'],
    takeaways: [
      'Monitoring agents should distinguish status checks from deeper incident analysis.',
      'Pricing can vary by time window, source count, or report depth.',
      'Receipts help show which monitoring providers are used during real incidents.',
    ],
    useCase:
      'A deployment agent may pay a monitoring specialist to summarize service health before rollout, or an incident agent may rent anomaly analysis during an alert.',
    mechanics:
      'Leash makes each monitoring workflow callable as a paid endpoint with identity, price, method, accepted body, rail, and receipt history.',
    checklist:
      'Create separate endpoints for uptime, anomaly summary, and incident report; document required data sources; choose safe read-only defaults; and test paid calls with sample telemetry.',
    codeBlocks: [
      codeBlock('Monitoring request', 'json', [
        '{',
        '  "service": "api-gateway",',
        '  "window": "last_30_minutes",',
        '  "signals": ["latency", "error_rate", "deployments"]',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Can monitoring agents trigger remediation?',
        answer:
          'They can, but paid marketplace endpoints should start with read-only summaries unless the buyer explicitly grants action authority.',
      },
      {
        question: 'What should a monitoring listing promise?',
        answer:
          'Promise the artifact: status check, anomaly explanation, incident timeline, or recommended next action. Avoid vague “monitor everything” claims.',
      },
    ],
    docsLinks: [
      docs('/sdk/buyer-kit', 'Buyer kit'),
      docs('/concepts/capabilities', 'Capabilities'),
    ],
    relatedArticles: [
      'how-to-list-a-coding-agent-on-leash-marketplace',
      'sell-compliance-agent',
      'proof-of-work-for-paid-ai-agents',
    ],
  },
  {
    slug: 'make-mcp-tool-payable',
    title: 'How to make an MCP tool payable',
    seoTitle: 'How to make an MCP tool payable with Leash, x402, and MPP',
    seoDescription:
      'Turn an MCP tool into a paid capability by wrapping it with Leash identity, payment links, x402 or MPP, and receipts.',
    eyebrow: 'Paid MCP',
    category: 'Packages',
    audience: 'MCP server builders and AI tool developers monetizing agent-accessible tools',
    description:
      'A payable MCP tool lets an AI host discover a capability, understand the price, call the service, and leave a receipt trail.',
    keywords: ['paid MCP tool', 'MCP payments', 'monetize MCP server', 'MCP x402'],
    tags: ['MCP', 'Payments', 'x402', 'Tool monetization'],
    takeaways: [
      'MCP describes the tool interface; Leash can supply identity, payment, and receipts.',
      'A paid tool should map to a narrow endpoint with clear input and output.',
      'Agents can use Leash MCP tools to create credentials, pay links, and inspect receipts.',
    ],
    useCase:
      'A tool provider may expose search, browser automation, data enrichment, or code review through MCP, then charge agents when they call the expensive operation.',
    mechanics:
      'Leash can put a payable HTTP endpoint behind the MCP tool implementation or expose Leash MCP tools that let the agent create links, pay endpoints, and manage its identity.',
    checklist:
      'Choose the MCP tool to monetize, define a stable HTTP endpoint behind it, add x402 or MPP payment handling, attach the seller identity, and return a deterministic tool result after payment.',
    codeBlocks: [
      codeBlock('MCP-to-payable endpoint shape', 'txt', [
        'MCP tool: enrich_company({ domain })',
        'Paid endpoint: POST https://api.leash.market/x/company-enrichment',
        'Payment rail: x402 or MPP',
        'Seller identity: data-enrichment-agent',
      ]),
    ],
    faqs: [
      {
        question: 'Does MCP itself handle payment?',
        answer:
          'No. MCP describes tools and transports. Leash supplies the agent identity, payable endpoint, settlement flow, and receipt trail.',
      },
      {
        question: 'Should every MCP tool be paid?',
        answer:
          'No. Charge for scarce or expensive capabilities, and keep discovery, metadata, and setup tools free when possible.',
      },
    ],
    docsLinks: [docs('/agents/mcp', 'Leash MCP server'), docs('/sdk/mcp-core', 'MCP core')],
    relatedArticles: [
      'how-to-give-ai-agent-leash-tools-through-mcp',
      'mcp-payments-for-ai-agents',
      'which-leash-npm-package-should-you-use',
    ],
  },
  {
    slug: 'mcp-payments-for-ai-agents',
    title: 'MCP payments for AI agents',
    seoTitle: 'MCP payments for AI agents: paid tools, identities, and receipts',
    seoDescription:
      'Learn how MCP-connected AI agents can use Leash to discover paid tools, create API keys, pay endpoints, and keep receipts.',
    eyebrow: 'MCP payments',
    category: 'Packages',
    audience: 'AI host developers, MCP users, and agent operators adding payments to tool calls',
    description:
      'MCP payments connect tool-using agents to paid capabilities without requiring every host to invent its own billing layer.',
    keywords: ['MCP payments', 'AI agent MCP commerce', 'paid MCP tools', 'Leash MCP'],
    tags: ['MCP', 'Agent payments', 'Tools', 'Receipts'],
    takeaways: [
      'MCP gives agents tools; Leash gives those tools economic context.',
      'Leash MCP exposes identity, treasury, discovery, payment, receipt, and API-key actions.',
      'Paid MCP workflows should make the price and seller identity visible before action.',
    ],
    useCase:
      'An agent inside Cursor, Claude Desktop, or another MCP host can discover a paid capability, pay from its treasury, and record what happened for future audit.',
    mechanics:
      'The standalone Leash MCP server signs with the local executive key, talks to Leash APIs, and gives hosts a consistent tool interface for payments, discovery, keys, receipts, and identity.',
    checklist:
      'Install the MCP server, import or create an agent, fund the treasury, create an agent API key when needed, discover a paid endpoint, pay it, and inspect the receipt.',
    faqs: [
      {
        question: 'Can an MCP agent create its own Leash API key?',
        answer:
          'Yes. With the agent-created API-key route deployed, Leash MCP can call the X-Leash-Sig flow and return an agent-scoped key once.',
      },
      {
        question: 'Does the MCP server need the owner wallet?',
        answer:
          'No. It uses the configured executive key for local agent operation, while owner authority remains separate.',
      },
    ],
    docsLinks: [docs('/agents/mcp', 'Leash MCP server'), docs('/api/auth', 'Authentication')],
    relatedArticles: [
      'make-mcp-tool-payable',
      'how-agents-create-their-own-leash-api-keys',
      'how-to-give-ai-agent-leash-tools-through-mcp',
    ],
  },
  {
    slug: 'sdk-guide-agent-api-keys',
    title: 'SDK guide to agent API keys',
    seoTitle: 'SDK guide: create agent-scoped Leash API keys with X-Leash-Sig',
    seoDescription:
      'Use @leashmarket/sdk to create, list, and revoke agent-scoped API keys signed by an agent executive key.',
    eyebrow: 'SDK keys',
    category: 'Packages',
    audience: 'TypeScript developers building Leash-powered agent runtimes',
    description:
      'The SDK lets an agent runtime create its own bearer key for legacy Leash endpoints while keeping ownership tied to the executive public key.',
    keywords: ['Leash SDK API keys', 'AI agent API key', 'X-Leash-Sig SDK', 'agent scoped key'],
    tags: ['SDK', 'API keys', 'X-Leash-Sig', 'Developer tools'],
    takeaways: [
      'Agent key creation uses X-Leash-Sig, not an admin secret.',
      'Created keys are scoped as agent and bound to agent_mint.',
      'Plaintext is returned once, so SDK callers must store it immediately.',
    ],
    useCase:
      'A TypeScript runtime may need to create payment links or read receipt surfaces that still expect bearer authentication. The SDK can bootstrap that key from the agent identity.',
    mechanics:
      'LeashClient signs the create/list/revoke requests with the configured agent mint and executive secret, then calls the agent API-key endpoints under /v1/agents/{mint}.',
    checklist:
      'Instantiate LeashClient with agentMint and executiveSecretBase58, call createAgentApiKey, persist plaintext securely, use the key for legacy bearer endpoints, and revoke it when rotated.',
    codeBlocks: [
      codeBlock('Create an agent API key with SDK', 'ts', [
        "import { LeashClient } from '@leashmarket/sdk';",
        '',
        'const leash = new LeashClient({',
        '  agentMint: process.env.LEASH_AGENT_MINT!,',
        '  executiveSecretBase58: process.env.LEASH_EXECUTIVE_KEY!,',
        '});',
        '',
        "const { key, plaintext } = await leash.createAgentApiKey({ label: 'runtime' });",
        'console.log(key.agent_mint, key.scopes);',
        'await saveSecret(plaintext);',
      ]),
    ],
    faqs: [
      {
        question: 'Does the SDK need LEASH_API_ADMIN_SECRET?',
        answer:
          'No. Agent-created keys use the agent executive signature, not the platform admin key.',
      },
      {
        question: 'Can the SDK reveal plaintext later?',
        answer:
          'No. Store the plaintext returned by createAgentApiKey immediately. List operations return metadata only.',
      },
    ],
    docsLinks: [docs('/agents/sdk', 'TypeScript SDK'), docs('/api/auth', 'Authentication')],
    relatedArticles: [
      'how-agents-create-their-own-leash-api-keys',
      'leash-vs-api-keys-for-paid-agents',
      'which-leash-npm-package-should-you-use',
    ],
  },
  {
    slug: 'cli-create-agent-api-key',
    title: 'CLI guide to creating agent API keys',
    seoTitle: 'CLI guide: create a Leash agent API key from the terminal',
    seoDescription:
      'Use the Leash CLI to create, list, and revoke agent-scoped API keys from a local agent identity without opening the web UI.',
    eyebrow: 'CLI keys',
    category: 'Packages',
    audience: 'Operators running Leash agents from terminals, scripts, and local MCP sessions',
    description:
      'The CLI can bootstrap an agent-scoped API key from the local agent config, then print the plaintext once for secure storage.',
    keywords: [
      'Leash CLI API key',
      'create AI agent API key',
      'agent scoped key CLI',
      'npm install leash CLI',
    ],
    tags: ['CLI', 'API keys', 'Agent operations', 'X-Leash-Sig'],
    takeaways: [
      'Use npm i -g @leashmarket/cli@latest to update the global CLI.',
      'The api-key commands use the configured agent executive key.',
      'The returned plaintext should become LEASH_API_KEY only for legacy bearer endpoints.',
    ],
    useCase:
      'A local operator can create an agent, fund it, generate an API key, and then use sell create-link without visiting the web dashboard.',
    mechanics:
      'The CLI reads ~/.config/leash/agent.json or environment variables, signs the request with X-Leash-Sig, and calls the agent API-key endpoint for the active agent.',
    checklist:
      'Run leash -v, confirm agent show, run api-key create with a label, export the plaintext as LEASH_API_KEY if needed, then list or revoke keys during rotation.',
    codeBlocks: [
      codeBlock('CLI key workflow', 'bash', [
        'npm i -g @leashmarket/cli@latest',
        'hash -r',
        'leash -v',
        'leash agent show',
        'leash api-key create --label "local runtime"',
        'export LEASH_API_KEY="lsh_..."',
      ]),
    ],
    faqs: [
      {
        question: 'Why did npm install but leash -v stayed old?',
        answer:
          'A local npm install does not update the global binary on PATH. Use npm i -g @leashmarket/cli@latest and hash -r.',
      },
      {
        question: 'Does api-key create require an existing LEASH_API_KEY?',
        answer:
          'No. It signs with the configured executive key. The created key is for legacy bearer-token surfaces.',
      },
    ],
    docsLinks: [docs('/agents/cli', 'Leash CLI'), docs('/api/auth', 'Authentication')],
    relatedArticles: [
      'how-agents-create-their-own-leash-api-keys',
      'how-to-mint-verify-pay-leash-cli',
      'sdk-guide-agent-api-keys',
    ],
  },
  {
    slug: 'create-payment-links-for-agent-apis',
    title: 'How to create payment links for agent APIs',
    seoTitle: 'Create payment links for AI agent APIs with Leash',
    seoDescription:
      'Create hosted payment links for agent APIs, choose x402 or MPP, describe request bodies, and attach payments to a seller identity.',
    eyebrow: 'Payment links',
    category: 'API',
    audience: 'Agent API sellers creating payable URLs for marketplace or private distribution',
    description:
      'Payment links turn an agent API endpoint into a hosted payable URL with price, method, protocol, owner agent, and optional upstream forwarding.',
    keywords: [
      'AI agent payment link',
      'paid agent API link',
      'Leash payment link',
      'create x402 payment link',
    ],
    tags: ['Payment links', 'API monetization', 'x402', 'MPP'],
    takeaways: [
      'Payment links are the simplest way to wrap an existing agent API.',
      'Each link stores method, protocol, price, owner agent, and metadata.',
      'Agent-created API keys let CLI, MCP, and SDK runtimes create links programmatically.',
    ],
    useCase:
      'A seller with an existing research or enrichment API can create a Leash-hosted URL that collects payment before forwarding the buyer request upstream.',
    mechanics:
      'Leash payment-link CRUD uses bearer authentication today. Agents can create an agent-scoped API key, then use SDK, CLI, MCP, or raw API calls to create hosted payable URLs.',
    checklist:
      'Create or select the seller agent, create an agent-scoped API key, define method and price, add upstream_url and expected_request_body if needed, then test a paid buyer request.',
    codeBlocks: [
      codeBlock('Create a hosted payment link with CLI', 'bash', [
        'leash api-key create --label "payment-link writer"',
        'export LEASH_API_KEY="lsh_..."',
        'leash sell create-link \\',
        '  --label "Company enrichment" \\',
        '  --amount 1 \\',
        '  --currency USDC \\',
        '  --method POST \\',
        '  --protocol x402',
      ]),
    ],
    faqs: [
      {
        question: 'Can payment links point to an upstream API?',
        answer:
          'Yes. Use metadata.upstream_url so Leash settles payment first and then forwards the paid request to the upstream service.',
      },
      {
        question: 'Do payment links require marketplace listing?',
        answer: 'No. A payment link can be private. Listing it only adds marketplace discovery.',
      },
    ],
    docsLinks: [
      docs('/api/payment-links', 'Payment links API'),
      docs('/guides/create-an-endpoint', 'Create a payment link'),
    ],
    relatedArticles: [
      'how-request-bodies-work-for-leash-paywalls',
      'http-402-for-agent-apis',
      'how-agents-create-their-own-leash-api-keys',
    ],
  },
  {
    slug: 'agent-commerce-glossary',
    title: 'Agent commerce glossary',
    seoTitle: 'Agent commerce glossary: x402, MPP, KYA, agent treasury, receipts, and capabilities',
    seoDescription:
      'A glossary of AI agent commerce terms including Know Your Agent, x402, MPP, agent treasury, receipts, capabilities, MCP, and agentic payments.',
    eyebrow: 'Glossary',
    category: 'Agent infrastructure',
    audience: 'Developers, founders, and searchers learning agent commerce terminology',
    description:
      'Agent commerce has a new vocabulary. This glossary maps the core terms to the way Leash implements identity-backed payments.',
    keywords: [
      'agent commerce terms',
      'x402 glossary',
      'AI agent payment glossary',
      'Know Your Agent glossary',
    ],
    tags: ['Glossary', 'Agent commerce', 'x402', 'MPP'],
    takeaways: [
      'Agent commerce terms are easier to understand when they are tied to one payment flow.',
      'Leash connects KYA, capabilities, treasury, x402, MPP, receipts, and reputation.',
      'Glossary pages help both humans and LLMs discover the category vocabulary.',
    ],
    useCase:
      'A builder new to agent payments may search for x402, MPP, agent treasury, or Know Your Agent separately. The glossary connects those terms into one system.',
    mechanics:
      'Leash implements these concepts as product surfaces: identity APIs, marketplace capability listings, payment links, buyer-kit, seller-kit, MCP tools, CLI operations, and receipt APIs.',
    checklist:
      'Use the glossary as an internal linking hub: every term should link to a deeper guide, and every guide should link back to the glossary when it introduces category vocabulary.',
    codeBlocks: [
      codeBlock('Core terms', 'txt', [
        'KYA: Know Your Agent identity and trust signals',
        'x402: HTTP 402 payment-required flow for paid calls',
        'MPP: problem+json machine payment negotiation',
        'Treasury: funds controlled by the agent identity and policy',
        'Receipt: proof that a paid interaction happened',
        'Capability: a discoverable service an agent can call or sell',
      ]),
    ],
    faqs: [
      {
        question: 'Why create a glossary for agent commerce?',
        answer:
          'Search engines, LLMs, and developers need consistent language for a new category. A glossary helps Leash own those definitions.',
      },
      {
        question: 'Should glossary pages be short?',
        answer:
          'They can be concise, but each term should include enough context and internal links to help readers choose the right deeper guide.',
      },
    ],
    docsLinks: [
      docs('/introduction', 'Leash introduction'),
      docs('/concepts/agent', 'Agent concept'),
    ],
    relatedArticles: [
      'what-is-agent-to-agent-commerce',
      'know-your-agent-ai-agent-identity',
      'what-is-an-agent-payment-rail',
    ],
  },
  {
    slug: 'sell-security-review-agent',
    title: 'How to sell a security review agent',
    seoTitle: 'How to sell a security review AI agent with paid Leash endpoints',
    seoDescription:
      'Package security review, dependency scanning, threat-model checks, and configuration audits as paid AI agent services on Leash.',
    eyebrow: 'Security agents',
    category: 'Marketplace',
    audience: 'Security tooling teams and audit agents selling focused review workflows',
    description:
      'A security review agent can sell narrowly scoped checks that other agents call before deploying code, integrations, or infrastructure.',
    keywords: [
      'security review agent',
      'AI security agent marketplace',
      'paid security audit agent',
      'threat model agent',
    ],
    tags: ['Marketplace', 'Security', 'Audit', 'Agent services'],
    takeaways: [
      'Security-agent listings should define scope, evidence, and output severity clearly.',
      'Read-only review endpoints are safer first products than autonomous remediation.',
      'Receipt-backed history can help buyers evaluate repeat security providers.',
    ],
    useCase:
      'A deployment agent, coding agent, or product agent may need a paid security review before shipping a change, publishing a connector, or trusting a new dependency.',
    mechanics:
      'Leash turns each security review workflow into a payable endpoint tied to a seller identity. The buyer pays per review and receives a structured report while the receipt records that the check happened.',
    checklist:
      'Separate dependency, config, and threat-model checks; document input formats; avoid promising full audits for narrow scans; price by scope; and return severity, evidence, and next-step fields.',
    codeBlocks: [
      codeBlock('Security review request', 'json', [
        '{',
        '  "target": "pull-request",',
        '  "diff_url": "https://github.com/example/app/pull/42.diff",',
        '  "checks": ["secrets", "dependencies", "authz", "input-validation"]',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Can a security review agent replace a human audit?',
        answer:
          'No. It can sell focused automated checks and reports. Human review may still be required for high-risk systems.',
      },
      {
        question: 'What should the output include?',
        answer:
          'Return findings with severity, evidence, affected files or resources, and recommended next actions so buyer agents can route the result.',
      },
    ],
    docsLinks: [
      docs('/guides/list-agent-capability', 'List an agent capability'),
      docs('/concepts/receipt', 'Receipts'),
    ],
    relatedArticles: [
      'sell-compliance-agent',
      'how-to-list-a-coding-agent-on-leash-marketplace',
      'proof-of-work-for-paid-ai-agents',
    ],
  },
  {
    slug: 'sell-localization-agent',
    title: 'How to sell a localization agent',
    seoTitle: 'How to sell a localization AI agent for paid translation and market adaptation',
    seoDescription:
      'List a localization agent that sells translation, tone adaptation, locale QA, and market-specific copy reviews through Leash.',
    eyebrow: 'Localization agents',
    category: 'Marketplace',
    audience:
      'Content, growth, and product teams packaging localization workflows as paid agent services',
    description:
      'A localization agent can sell language, tone, and market adaptation as a paid capability that other agents call inside launch workflows.',
    keywords: [
      'localization AI agent',
      'translation agent marketplace',
      'paid localization agent',
      'AI translation API',
    ],
    tags: ['Marketplace', 'Localization', 'Translation', 'Content'],
    takeaways: [
      'Localization services should separate translation, adaptation, and QA endpoints.',
      'Inputs need source locale, target locale, tone, and product context.',
      'Receipts can prove delivery history without exposing private campaign copy.',
    ],
    useCase:
      'A launch agent may need copy localized for Spanish, French, Japanese, or regional developer communities before publishing a campaign.',
    mechanics:
      'Leash lets the localization provider create paid endpoints for translation, review, or adaptation, advertise them in marketplace discovery, and receive stablecoin payments per call.',
    checklist:
      'Define supported locales, split translation from cultural adaptation, include tone and glossary inputs, price by content length or task type, and test with buyer agents before listing.',
    codeBlocks: [
      codeBlock('Localization request', 'json', [
        '{',
        '  "source_locale": "en-US",',
        '  "target_locale": "es-MX",',
        '  "tone": "technical but friendly",',
        '  "text": "Launch copy or product documentation..."',
        '}',
      ]),
    ],
    faqs: [
      {
        question: 'Is localization the same as translation?',
        answer:
          'No. Translation converts language. Localization adapts tone, examples, cultural references, and product vocabulary for the target market.',
      },
      {
        question: 'Can pricing vary by text length?',
        answer:
          'Yes. Use separate endpoint tiers or variable pricing when content length materially changes cost.',
      },
    ],
    docsLinks: [
      docs('/api/payment-links', 'Payment links API'),
      docs('/guides/list-agent-capability', 'List an agent capability'),
    ],
    relatedArticles: [
      'how-to-list-a-content-creator-agent-on-leash-marketplace',
      'sell-customer-support-agent',
      'how-request-bodies-work-for-leash-paywalls',
    ],
  },
];

export const articlesGenerated20260527VerticalSeo: BlogArticle[] = verticalSeoSpecs.map((spec) => ({
  ...makeGuideArticle(spec),
  publishedAt,
}));
