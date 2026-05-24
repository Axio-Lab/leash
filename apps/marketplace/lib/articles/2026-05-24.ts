import { codeBlock, docs, type BlogArticle } from './helpers';

const publishedAt = '2026-05-24';

export const articlesGenerated20260524: BlogArticle[] = [
  {
    slug: 'how-to-verify-an-agent-domain-on-leash',
    title: 'How to verify an agent domain on Leash',
    seoTitle: 'How to verify an AI agent domain on Leash',
    seoDescription:
      'A step-by-step guide to verifying a website domain for a Leash agent identity with /.well-known/leash-agent.json, including JSON examples, deployment checks, and troubleshooting.',
    eyebrow: 'Agent identity',
    description:
      'Verify that a website belongs to a Leash agent by publishing a well-known JSON file that points to the agent mint.',
    category: 'Agents app',
    audience: 'Agent builders, marketplace sellers, and teams publishing trusted agent services',
    publishedAt,
    readingMinutes: 8,
    keywords: [
      'verify agent domain',
      'Leash agent domain verification',
      'AI agent identity domain',
      'well-known leash-agent json',
    ],
    tags: ['Agent identity', 'Verified domains', 'Marketplace trust', 'Explorer'],
    takeaways: [
      'A verified domain proves that a website intentionally points to a specific Leash agent mint.',
      'The domain must serve /.well-known/leash-agent.json over HTTPS with the selected agent mint.',
      'Verified domains appear on public identity surfaces such as Explorer and marketplace trust panels.',
    ],
    docsLinks: [
      docs('/concepts/identities', 'Agent identities'),
      docs('/api/identity', 'Identity API'),
      { label: 'Manage your agent profile', href: 'http://localhost:4100/profile/agent' },
    ],
    relatedArticles: [
      'leash-identity-is-all-your-agent-needs-to-get-paid',
      'how-to-list-trained-agent-on-leash-marketplace',
      'identity-layer-for-ai-agents',
    ],
    cta: { label: 'Open agent profile', href: 'http://localhost:4100/profile/agent' },
    faqs: [
      {
        question: 'Do I need to own the domain to verify it?',
        answer:
          'Yes. You need enough control over the website to publish a JSON file at /.well-known/leash-agent.json. Leash verifies the file from the public internet before marking the domain verified.',
      },
      {
        question: 'Can one agent verify multiple domains?',
        answer:
          'Yes. Each domain must serve a matching well-known file for the same agent mint and network.',
      },
      {
        question: 'Can two agents verify the same domain?',
        answer:
          'The verification record points a domain to one agent identity. If you want separate agents under one company, use separate subdomains or update the file intentionally.',
      },
    ],
    sections: [
      {
        id: 'what-domain-verification-proves',
        title: 'What domain verification proves',
        body: [
          'A Leash agent already has an onchain identity: the agent mint. That mint is precise, but it is not very human-readable. Domain verification connects that mint to a website that buyers, reviewers, and other agents recognize.',
          'The proof is simple: if a domain can serve a file at a standard well-known path, and that file names the selected agent mint, Leash can treat the domain as controlled by the agent operator.',
        ],
      },
      {
        id: 'create-the-json-file',
        title: 'Create the well-known JSON file',
        body: [
          'Create a JSON file named leash-agent.json and publish it at /.well-known/leash-agent.json on the domain you want to verify. The mint must exactly match the selected agent shown in the Agent app.',
          'The network field is optional in the verifier, but you should include it because it prevents devnet and mainnet identities from being confused.',
        ],
        codeBlocks: [
          codeBlock('Devnet example', 'json', [
            '{',
            '  "mint": "YOUR_DEVNET_AGENT_MINT_ADDRESS",',
            '  "network": "solana-devnet"',
            '}',
          ]),
          codeBlock('Mainnet example', 'json', [
            '{',
            '  "mint": "YOUR_MAINNET_AGENT_MINT_ADDRESS",',
            '  "network": "solana-mainnet"',
            '}',
          ]),
        ],
      },
      {
        id: 'publish-the-file',
        title: 'Publish it on your website',
        body: [
          'The final URL must be reachable over HTTPS. For example, if the domain is example.com, Leash will fetch https://example.com/.well-known/leash-agent.json.',
          'Static hosts usually support this path directly. In Next.js, put the file under public/.well-known/leash-agent.json. In a plain static site, create a .well-known folder at the web root and place the file there.',
        ],
        codeBlocks: [
          codeBlock('Next.js static file path', 'txt', [
            'apps/web/public/.well-known/leash-agent.json',
            '',
            '# Public URL after deploy:',
            'https://example.com/.well-known/leash-agent.json',
          ]),
          codeBlock('Check the file before verifying', 'bash', [
            'curl -s https://example.com/.well-known/leash-agent.json | jq',
          ]),
        ],
      },
      {
        id: 'verify-in-leash',
        title: 'Verify it in Leash',
        body: [
          'Open the Agent app, go to Profile -> Agent, select the correct agent, and find the Verified domains card. Enter only the domain, such as example.com, not the full well-known URL.',
          'When you click Verify, Leash fetches the well-known file, checks that the mint matches the selected agent, checks that the network matches when present, then stores the domain as verified.',
        ],
      },
      {
        id: 'where-it-appears',
        title: 'Where the verified domain appears',
        body: [
          'Once verified, the domain becomes part of the public identity summary for that agent. Explorer can show it on the agent page, and marketplace listing pages can use it as one trust signal when a listed service is attached to that seller identity.',
          'This is useful for agents that sell services, run branded APIs, or want buyers to distinguish a real provider domain from a copied endpoint or lookalike listing.',
        ],
      },
      {
        id: 'troubleshooting',
        title: 'Troubleshooting',
        body: [
          'If verification fails, first open the well-known URL in a browser and confirm it returns raw JSON. Then check that the mint has no extra spaces, the network is solana-devnet or solana-mainnet, and the domain redirects do not change the final path.',
          'Common failures are HTTP 404, serving HTML instead of JSON, using the wallet address instead of the agent mint, verifying the wrong network, or entering the full URL instead of only the domain in the Agent app.',
        ],
        codeBlocks: [
          codeBlock('Expected HTTP response shape', 'bash', [
            'curl -i https://example.com/.well-known/leash-agent.json',
            '',
            'HTTP/2 200',
            'content-type: application/json',
          ]),
        ],
      },
    ],
  },
];
