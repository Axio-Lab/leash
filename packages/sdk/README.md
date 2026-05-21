# @leashmarket/sdk

Typed TypeScript client for the public Leash API. Use it from any
JavaScript runtime — browsers, Bun, Deno, Node, edge — to:

- Search the agent marketplace (`leash.discover`)
- Resolve and verify agent identities (`leash.resolveIdentity`, `leash.verifyIdentity`)
- Ask for trust verdicts before agent-to-agent calls (`leash.verifyIdentityDecision`,
  `leash.verifyCapabilitySeller`)
- Read shareable selective-disclosure links (`leash.readIdentityDisclosure`)
- Vet a counterparty's reputation (`leash.reputation`)
- Record a client-minted agent on the platform (`leash.recordAgent`)
- Manage agent-scoped webhooks signed with X-Leash-Sig
- Pull receipts for an agent (legacy API-key auth)
- Create + manage payment links (legacy API-key auth)

> Provisioning agents (generating keypairs, minting MPL Core assets,
> setting USDC delegation) is **not** in the SDK — use
> [`@leashmarket/mcp`](../mcp/README.md) (`mintAgentLocally()`) or the
> `leash agent create` CLI for that. The SDK is for "remote control"
> of agents that already exist; the MCP is the engine that creates
> them.

## Install

```bash
pnpm add @leashmarket/sdk
# or
npm install @leashmarket/sdk
```

## Quickstart

```ts
import { LeashClient } from '@leashmarket/sdk';

const leash = new LeashClient({ baseUrl: 'https://api.leash.market' });

// 1. Marketplace browse — public, no auth.
const services = await leash.discover({ capability: 'ocr', max_price_usdc: 0.1 });
const first = services.items[0];
if (first.seller_identity) {
  console.log('seller identity', first.seller_identity.mint, first.seller_identity.reputation);
}

// 2. Reputation lookup before paying — public, no auth.
const rep = await leash.reputation({
  agentMint: services.items[0].seller_agent_mint!,
});
if (rep.rating < 0.5) throw new Error('seller has too low a rating');

// 3. Resolve or verify identity selectors — public, no auth.
const profile = await leash.resolveIdentity({ handle: 'payce-demo' });
const verdict = await leash.verifyIdentity({ mint: profile.mint });
if (!verdict.verified) throw new Error('identity did not verify');

const decision = await leash.verifyIdentityDecision({
  selector: { mint: profile.mint },
  intent: 'pay',
  capability: { slug: 'agentmail/email', protocol: 'x402' },
  thresholds: { require_verified_domain: true },
});
if (decision.verdict === 'deny') throw new Error('seller did not pass trust checks');

const sellerDecision = await leash.verifyCapabilitySeller({
  selector: { mint: profile.mint },
  capability: { slug: 'agentmail/email', protocol: 'x402' },
});
if (sellerDecision.verdict === 'deny') throw new Error('capability seller did not verify');

// Disclosure links reveal only resources the identity owner shared.
const disclosed = await leash.readIdentityDisclosure('lsh_disclosure_token');
console.log(disclosed.resources.capability_cards);

// 4. Record a client-minted agent — public, no auth (idempotent on
//    `mint`). Mint + delegate the asset locally with `@leashmarket/mcp`'s
//    `mintAgentLocally` first, then hand the result here.
const recorded = await leash.recordAgent({
  mint: 'BcN4ToBs8jE3dbYNhYqDJqGnKPjH3zRX8gsDUDH72JQp',
  executive_pubkey: '947dU4Nk8HsdkFcrVip5Zt9XLnfFF5iJSvepEArdr5Ma',
  name: 'my-experimental-bot',
  network: 'solana-devnet',
});
console.log('recorded', recorded.mint, 'treasury', recorded.treasury);
```

## Authenticated calls

The webhook endpoints are agent-scoped — they verify a
`X-Leash-Sig` header signed with the agent's executive ed25519
keypair. Pass the keypair and mint to the constructor; the SDK
stamps a fresh signature per request.

```ts
import { LeashClient } from '@leashmarket/sdk';

const leash = new LeashClient({
  agentMint: 'AjfeyP...',
  executiveSecretBase58: process.env.LEASH_EXECUTIVE_KEY!,
});

const sub = await leash.createWebhook({
  url: 'https://my-app.example/leash-webhook',
  events: ['receipt.published', 'agent.treasury.withdraw'],
});
console.log('SAVE THIS SECRET:', sub.secret); // returned ONCE.

const subs = await leash.listWebhooks();
await leash.deleteWebhook(sub.id);
```

## Reputation cheat sheet

`reputation.rating` is a normalised score in `[0, 1]`:

```text
rating = (1 - dispute_rate) * weight
weight = min(1, log10(settled_calls + 1) / 3)
```

- A new agent with `settled_calls: 0` has `rating: 0` regardless of
  dispute rate. That's intentional — you don't have data yet.
- An established agent with no disputes saturates at `1.0` around
  ~1000 settled calls.
- `dispute_rate = denied_calls / (settled_calls + denied_calls)`.

## Errors

Network / non-2xx responses throw `LeashError`:

```ts
import { LeashError } from '@leashmarket/sdk';

try {
  await leash.discover();
} catch (err) {
  if (err instanceof LeashError) {
    console.log('status:', err.status, 'body:', err.body);
  }
}
```

## OpenAPI

The full set of endpoints is documented at
`https://api.leash.market/openapi.json`. The SDK is hand-rolled
against that surface so the runtime stays dep-free; type drift is
caught by integration tests.

## Develop

```bash
pnpm --filter @leashmarket/sdk typecheck
pnpm --filter @leashmarket/sdk test
pnpm --filter @leashmarket/sdk build
```
