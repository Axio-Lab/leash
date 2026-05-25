import { codeBlock, docs, type BlogArticle } from './helpers';

const publishedAt = '2026-05-25';

export const articlesGenerated20260525: BlogArticle[] = [
  {
    slug: 'how-request-bodies-work-for-leash-paywalls',
    title: 'How request bodies work for Leash paywalls',
    seoTitle: 'How POST request bodies work for Leash x402 and MPP paywalls',
    seoDescription:
      'Learn how sellers describe expected_request_body metadata when creating a Leash paywall, and how buyer agents send the real POST body after payment.',
    eyebrow: 'Paywall design',
    description:
      'Creation-time expected body metadata tells buyers what to send; the actual request body is supplied by the buyer when calling the hosted Leash URL.',
    category: 'API',
    audience: 'Agent builders, API sellers, MCP users, and buyer-agent developers',
    publishedAt,
    readingMinutes: 8,
    keywords: [
      'Leash expected_request_body',
      'x402 POST request body',
      'MCP paid endpoint body',
      'AI agent API paywall',
      'monetize POST endpoint',
    ],
    tags: ['API monetization', 'Request body', 'x402', 'MCP', 'Buyer agents'],
    takeaways: [
      'The paywall creator describes the expected body with metadata.expected_request_body.',
      'The buyer sends the real body to the hosted /x/{id} URL when paying or retrying the request.',
      'Leash settles first, strips payment headers, then forwards the buyer body to metadata.upstream_url.',
      'CLI, SDK, MCP, API, and marketplace setup all use the same metadata convention.',
    ],
    docsLinks: [
      docs('/api/payment-links', 'Payment links API'),
      docs('/guides/create-an-endpoint', 'Create a payment link'),
      docs('/agents/mcp', 'Leash MCP server'),
      docs('/agents/sdk', 'TypeScript SDK'),
    ],
    relatedArticles: [
      'monetize-api-endpoint-with-leash-seller-kit',
      'how-to-list-trained-agent-on-leash-marketplace',
      'how-to-get-your-ai-agent-paid-on-leash',
    ],
    cta: { label: 'Monetize an endpoint', href: '/creator/monetize' },
    faqs: [
      {
        question: 'Does Leash store the buyer request body during paywall creation?',
        answer:
          'No. Creation stores expected_request_body metadata only. The buyer sends the real body later when it calls the hosted Leash paywall URL.',
      },
      {
        question: 'Can each agent use a different request body shape?',
        answer:
          'Yes. expected_request_body is an arbitrary JSON object, so a design agent, finance agent, search agent, or content agent can describe the body it expects.',
      },
      {
        question: 'What happens after payment succeeds?',
        answer:
          'Leash forwards the buyer request body and safe headers to metadata.upstream_url, then returns the upstream response to the buyer.',
      },
    ],
    sections: [
      {
        id: 'two-different-bodies',
        title: 'There are two different body concepts',
        body: [
          'The creation-time body is not the live request. It is a description of what buyers should send. Leash stores it as metadata.expected_request_body so marketplace pages, agents, SDK clients, and MCP tools can inspect it before paying.',
          'The runtime body is the real buyer payload. The buyer sends it to the Leash hosted URL, not directly to the seller upstream URL. After settlement, Leash forwards that exact request body to the upstream service.',
        ],
      },
      {
        id: 'seller-sets-expectation',
        title: 'The seller sets the expected shape',
        body: [
          'Leash should not force every agent endpoint into one schema. A design agent may need prompt, style, and format. A finance agent may need wallet, timeframe, and risk level. A search agent may need query and limit.',
          'Because of that, expected_request_body is flexible. It is just a JSON object that communicates the shape the seller expects.',
        ],
        codeBlocks: [
          codeBlock('Creation metadata', 'json', [
            '{',
            '  "metadata": {',
            '    "upstream_url": "https://api.example.com/design",',
            '    "expected_request_body": {',
            '      "prompt": "string",',
            '      "style": "string",',
            '      "format": "string"',
            '    }',
            '  }',
            '}',
          ]),
        ],
      },
      {
        id: 'buyer-sends-real-body',
        title: 'The buyer sends the real body to Leash',
        body: [
          'When a buyer agent is ready to call the paid capability, it sends its real JSON body to the hosted Leash /x/{id} URL. The payment proof travels with that request. Payment headers are stripped before Leash calls the upstream endpoint.',
          'This makes the hosted paywall behave like the original POST endpoint, with payment and receipts added in front.',
        ],
        codeBlocks: [
          codeBlock('Paid buyer request', 'bash', [
            'curl -X POST "https://api.leash.market/x/design-agent?network=solana-devnet" \\',
            '  -H "Content-Type: application/json" \\',
            '  -H "X-PAYMENT: <payment-proof>" \\',
            '  -d \'{"prompt":"Design a landing page","style":"premium dark mode","format":"html"}\'',
          ]),
        ],
      },
      {
        id: 'cli-sdk-mcp',
        title: 'Use the same field across CLI, SDK, MCP, and API',
        body: [
          'The convention is intentionally the same everywhere. CLI exposes --expected-body. MCP exposes expected_request_body. SDK and raw API callers pass it under metadata.expected_request_body.',
          'Agents can inspect the metadata before paying, construct their task-specific body, and call the payable URL with buyer-kit, CLI, MCP, or their own x402 client.',
        ],
        codeBlocks: [
          codeBlock('CLI creation', 'bash', [
            'leash sell create-link \\',
            '  --label "Design agent" \\',
            '  --amount 1 \\',
            '  --method POST \\',
            '  --upstream-url https://api.example.com/design \\',
            '  --expected-body \'{"prompt":"string","style":"string","format":"string"}\'',
          ]),
          codeBlock('SDK creation', 'ts', [
            'await leash.createPaymentLink({',
            "  label: 'Design agent',",
            '  owner_agent: agentMint,',
            "  method: 'POST',",
            "  price: '1 USDC',",
            "  currency: 'USDC',",
            '  response: { status: 200, mimeType: "application/json", body: { ok: true } },',
            '  metadata: {',
            "    upstream_url: 'https://api.example.com/design',",
            '    expected_request_body: { prompt: "string", style: "string", format: "string" },',
            '  },',
            '});',
          ]),
        ],
      },
    ],
  },
];
