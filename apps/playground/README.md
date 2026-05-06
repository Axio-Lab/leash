# @leashmarket/playground

Interactive playground (`leash · playground`) for the Leash stack. Drives the
runner, agents, sellers, buyers, and schemas from one place — same Roboto +
JetBrains Mono typography, white inverted logo, and aurora theme as
`@leashmarket/explorer` and `@leashmarket/agents`.

## Run

```bash
cp apps/playground/.env.local.example apps/playground/.env.local   # paste your Privy appId
pnpm install
pnpm --filter @leashmarket/playground dev                                # http://localhost:4000
```

For the dashboard's runner status to flip green, also start the runner:

```bash
pnpm --filter @leashmarket/runner start                                  # http://localhost:8787
```

If you start the runner on another port (e.g. `PORT=8788 pnpm --filter @leashmarket/runner start`),
set **`LEASH_RUNNER_URL=http://localhost:8788`** in `apps/playground/.env` and restart `next dev` —
the UI calls the runner from the **Next server**, which still defaults to port **8787**.

## Pages

| Route                      | What it does                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `/`                        | Dashboard: runner kill-switch state, env, jump links.                                       |
| `/runner`                  | Live tail of `receipts.jsonl` for any agent mint, with poll interval.                       |
| `/agents`                  | Track Core asset mints locally; click into a profile.                                       |
| `/agents/new`              | Mint + register a new agent in one tx, signed by the connected Privy wallet.                |
| `/agents/[mint]`           | Identity, treasury (SOL + SPL tokens), earn/spend totals, receipt feed, exec delegation.    |
| `/seller`                  | Hits a built-in `simpleX402Gate`-shaped echo route; toggle `x-payment` to see 402 vs allow. |
| `/buyer`                   | Build a `RulesV1` doc, fire `createBuyer().fetch(...)`, render the resulting receipt.       |
| `/schemas`                 | Live Zod validator for `ReceiptV1`, `RulesV1`, `RegistrationV1`, `LeashBlockV1`.            |
| `/a/[mint]/receipts.jsonl` | Public NDJSON proxy of the runner feed (kept for compatibility).                            |

## API routes

All wrap the SDK packages so the browser never touches Node-only code.

- `GET /api/runner/health` → `@leashmarket/runner /health`
- `GET /api/runner/pause` → `@leashmarket/runner /pause`
- `GET /api/receipts/[mint]` → parses NDJSON into `ReceiptV1[]` via `@leashmarket/schemas`
- `POST /api/buyer/fire` → `createBuyer({ agent, rules }).fetch(url, init)` from `@leashmarket/buyer-kit`
- `POST /api/seller/echo` → x402-shaped echo (matches `@leashmarket/seller-kit`'s `simpleX402Gate`)
- `GET /api/seller/payTo?asset=…` → `resolveSellerPayTo` (Asset Signer PDA)
- `GET /api/registry/resolve?uri=…` → `@leashmarket/registry-utils` `resolveByoUri`
- `POST /api/schemas/validate` → live Zod schemas from `@leashmarket/schemas`
- `GET /api/agents/identity?asset=…` → MIP-104 status, owner, AgentIdentity URI
- `GET /api/agents/balance?asset=…` → SOL + SPL (Token + Token-2022) for the Asset Signer PDA
- `GET /api/agents/executive?asset=…&authority=…` → executive registration + delegation status (read-only)
- `POST /api/agents/create`, `POST /api/agents/executive` → **server-side fallback only**, requires `LEASH_DEV_PAYER_SECRET_KEY`. The browser playground signs both flows directly with the Privy wallet via `lib/privy-umi.ts`.

## Auth & signing

Wallet auth is via [Privy](https://privy.io) (Solana embedded wallet + external
wallet support). When `NEXT_PUBLIC_PRIVY_APP_ID` is unset the app still loads,
but the topbar shows a "Privy not configured" badge.

The Privy `ConnectedSolanaWallet` is also the **on-chain signer** for every
playground action (`createAgent`, `registerExecutiveV1`, `delegateExecutionV1`).
The bridge lives in `lib/privy-umi.ts` — `usePrivyUmi()` returns a Umi instance
whose `identity` is the connected wallet (via Metaplex's `walletAdapterIdentity`
plugin). Fund the embedded wallet on devnet (`solana airdrop 1 <pubkey> --url devnet`)
before minting.

### Email login not working

1. **Do not put the app secret in the browser.** Only `NEXT_PUBLIC_PRIVY_APP_ID`
   is required for the React SDK. Values like `privy_app_secret_…` belong in
   **server** env vars only (never `NEXT_PUBLIC_*`). If that secret was ever in
   a `NEXT_PUBLIC_` variable, **rotate it** in the Privy dashboard after removing
   it from `.env`.
2. **`NEXT_PUBLIC_PRIVY_CLIENT_ID`** is optional and must be an **app client**
   id from the dashboard (Clients tab), not the app secret. If unsure, omit it.
3. In the Privy dashboard, enable **Email** under login methods and add
   **Allowed origins** for where you run the app (e.g. `http://localhost:3000`).
