import { codeBlock, docs, type BlogArticle } from './helpers';

const publishedAt = '2026-05-27';

export const articlesGenerated20260527: BlogArticle[] = [
  {
    slug: 'how-agents-create-their-own-leash-api-keys',
    title: 'How agents create their own Leash API keys',
    seoTitle: 'How AI agents create their own Leash API keys with SDK, CLI, and MCP',
    seoDescription:
      'Learn what needs a Leash API key, what stays public or X-Leash-Sig signed, and how AI agents create agent-scoped API keys from the SDK, CLI, and MCP.',
    eyebrow: 'Agent API keys',
    description:
      'Leash agents can now bootstrap their own API keys programmatically. The key is owned by the executive public key, bound to the agent mint, scoped as agent, and returned in plaintext only once.',
    category: 'Agent infrastructure',
    audience:
      'AI agent developers, MCP host builders, SDK users, CLI operators, and teams integrating Leash into autonomous runtimes',
    publishedAt,
    readingMinutes: 10,
    keywords: [
      'Leash API key',
      'AI agent API keys',
      'X-Leash-Sig',
      'agent scoped API key',
      'MCP API key',
      'Leash SDK',
      'Leash CLI',
    ],
    tags: ['API keys', 'X-Leash-Sig', 'SDK', 'MCP', 'CLI', 'Agent identity'],
    takeaways: [
      'Public discovery, reputation, and identity checks do not need a Leash API key.',
      'Agent-scoped bootstrap calls use X-Leash-Sig, proving control of the agent executive keypair.',
      'Created API keys use owner_wallet = executive pubkey, agent_mint = the signed agent, and scopes = ["agent"].',
      'The plaintext key is returned once, so agents and operators must store it immediately.',
    ],
    docsLinks: [
      docs('/api/auth', 'Authentication'),
      docs('/agents/sdk', 'TypeScript SDK'),
      docs('/agents/cli', 'Leash CLI'),
      docs('/agents/mcp', 'MCP server'),
      docs('/sdk/mcp-core', 'MCP core'),
    ],
    relatedArticles: [
      'why-leash-fits-agentic-wallets-and-agent-to-agent-settlement',
      'leash-identity-is-all-your-agent-needs-to-get-paid',
      'how-to-get-your-ai-agent-paid-on-leash',
    ],
    cta: { label: 'Read the API auth docs', href: 'https://docs.leash.market/api/auth' },
    faqs: [
      {
        question: 'Does every Leash call need an API key?',
        answer:
          'No. Discovery, reputation, public identity resolution, and identity verification are public reads. Agent bootstrap calls such as creating an agent API key use X-Leash-Sig. Legacy surfaces such as payment-link CRUD and receipt reads still use bearer API keys.',
      },
      {
        question: 'Who owns an agent-created Leash API key?',
        answer:
          'The key is attributed to the agent executive public key in owner_wallet and bound to the specific agent mint in agent_mint. That lets one executive manage multiple agents without one agent listing or revoking another agent’s keys.',
      },
      {
        question: 'Can the plaintext API key be revealed later?',
        answer:
          'No. Agent-created keys return plaintext once on create. List and revoke operations return only metadata such as id, prefix, last4, scope, and timestamps.',
      },
    ],
    sections: [
      {
        id: 'why-agent-created-api-keys-matter',
        title: 'Why agent-created API keys matter',
        body: [
          'Autonomous agents should not have to open a dashboard just to get a credential. If an agent already has a Leash identity and controls its executive keypair, it can prove that control directly with X-Leash-Sig.',
          'That proof is enough for Leash to issue a narrow API key owned by the executive public key and bound to the agent mint. The key can then be stored by the runtime and used for legacy bearer-token endpoints that still require LEASH_API_KEY.',
          'This keeps bootstrap simple: public reads stay public, signed agent actions stay signed, and bearer keys are available when a runtime needs compatibility with existing API-key surfaces.',
        ],
      },
      {
        id: 'what-needs-a-key',
        title: 'What needs a key and what does not',
        body: [
          'A buyer agent can browse Leash marketplace listings, inspect reputation, resolve handles, verify domains, and request identity trust decisions without an API key. Those are public reads because agents need to evaluate counterparties before paying.',
          'Agent-scoped actions such as creating an API key or managing agent webhooks use X-Leash-Sig. The request is signed with the executive keypair over a canonical envelope that includes method, path, timestamp, body hash, and agent mint.',
          'Legacy authenticated endpoints still expect a bearer token. Payment-link CRUD and some receipt surfaces are the important examples today. The new agent-created key gives SDK, CLI, and MCP runtimes a programmatic way to obtain that token.',
        ],
        codeBlocks: [
          codeBlock('Auth map', 'txt', [
            'Public: discover, reputation, identity resolve, identity verify',
            'X-Leash-Sig: agent API keys, agent webhooks',
            'Bearer API key: payment-link CRUD, receipts, legacy authenticated API surfaces',
          ]),
        ],
      },
      {
        id: 'create-with-sdk-cli-mcp',
        title: 'Create a key from SDK, CLI, or MCP',
        body: [
          'The SDK is best when the agent runtime is already TypeScript. Pass the agent mint and executive secret to LeashClient, then call createAgentApiKey. The response includes the key record and plaintext.',
          'The CLI is best for human operators setting up a local runtime. It reads the same agent.json as the MCP server, signs the request with the executive keypair, and prints the plaintext once.',
          'The MCP tools are best for AI hosts. An agent can call leash_create_agent_api_key, store the returned plaintext in its secure runtime configuration, then later list or revoke keys without seeing plaintext again.',
        ],
        codeBlocks: [
          codeBlock('SDK', 'ts', [
            "import { LeashClient } from '@leashmarket/sdk';",
            '',
            'const leash = new LeashClient({',
            '  agentMint: process.env.LEASH_AGENT_MINT!,',
            '  executiveSecretBase58: process.env.LEASH_EXECUTIVE_KEY!,',
            '});',
            '',
            "const { key, plaintext } = await leash.createAgentApiKey({ label: 'worker' });",
            'console.log(key.id, key.scopes); // ["agent"]',
            'console.log("store once", plaintext);',
          ]),
          codeBlock('CLI', 'bash', [
            'leash api-key create --label "local worker"',
            'leash api-key list',
            'leash api-key revoke <id>',
          ]),
          codeBlock('MCP tools', 'txt', [
            'leash_create_agent_api_key({ "label": "cursor worker" })',
            'leash_list_agent_api_keys({ "include_disabled": false })',
            'leash_revoke_agent_api_key({ "id": "01H..." })',
          ]),
        ],
      },
      {
        id: 'security-model',
        title: 'The security model is deliberately narrow',
        body: [
          'Agent-created keys always use the agent scope. They are not admin keys and they are not broad user keys. They are designed for one agent runtime to use Leash legacy bearer-token surfaces without inheriting platform-level authority.',
          'The API stores agent_mint alongside owner_wallet because one executive may manage multiple agents. List and revoke operations must match the signed agent mint, not just the executive wallet.',
          'Plaintext is intentionally one-time. Treat the response like a secret: write it to a secret manager, runtime env var, or encrypted config immediately. If it is lost, revoke and create a new key.',
        ],
      },
      {
        id: 'what-to-build-next',
        title: 'What this unlocks for autonomous agents',
        body: [
          'An MCP-hosted agent can now provision its own credential, create hosted paywalls, read receipts, and rotate secrets without waiting for a human to use the web UI.',
          'A CLI-operated agent can bootstrap a local LEASH_API_KEY in seconds, then use the same identity for payment links, receipt history, and later MCP sessions.',
          'A custom SDK runtime can keep the clean separation: executive keypair for signed agent identity actions, agent-scoped API key for legacy bearer-token actions, and receipts for proof after work is paid.',
        ],
      },
    ],
  },
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
