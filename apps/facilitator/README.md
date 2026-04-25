# `@leash/facilitator-app`

Thin runner around [`@leash/facilitator`](../../packages/facilitator) for
operating `https://facilitator.leash.dev`. The Hono server speaks the
[x402 facilitator HTTP protocol](https://github.com/x402-foundation/x402)
(`/verify`, `/settle`, `/supported`, plus a `/health` extra) and is
wire-compatible with `HTTPFacilitatorClient` from `@x402/core`, so any
`@leash/buyer-kit` / `@leash/seller-kit` deployment can point at it
with zero code changes.

## v0.1 scope

- **Devnet only.** Mainnet support is coded but disabled by default;
  flip via `LEASH_FACILITATOR_NETWORKS=mainnet` once you've topped up
  the fee-payer with real SOL.
- **Single fee payer.** The signer's pubkey is the SOL-paying account
  for every settlement; load-balancing across multiple payers will
  arrive once we wire up multi-key support in `@leash/facilitator`.
- **No auth, no rate limits.** Front it with a Cloudflare Worker if
  you publish the URL.

## Run locally

```bash
# 1. Generate a DEDICATED keypair for the facilitator. It MUST be
#    different from any wallet that signs the buyer-side SPL transfer
#    (e.g. an agent treasury executive). x402's facilitator scheme
#    rejects every settle with
#      invalid_exact_svm_payload_transaction_fee_payer_transferring_funds
#    when the fee payer is also the transfer authority.
solana-keygen new -o .leash-fee-payer.json --no-bip39-passphrase

# 2. Fund it on devnet (free, takes ~5s)
solana airdrop 1 -k .leash-fee-payer.json --url https://api.devnet.solana.com

# 3. Boot the server
export LEASH_FACILITATOR_SECRET_KEY="$(cat .leash-fee-payer.json)"
pnpm --filter @leash/facilitator-app dev
```

> Smoke-test the local facilitator with a real on-chain settle:
>
> ```bash
> # Once-only: fund a buyer treasury + delegation (re-uses .env.e2e).
> pnpm --filter @leash/api e2e:devnet
>
> # Then any time:
> LEASH_FACILITATOR_URL=http://localhost:8787 \
>   pnpm --filter @leash/api facilitator:smoke
> ```
>
> The smoke script spins up a one-route seller-kit Hono server in-
> process and pays it through `@leash/buyer-kit`, asserting a real
> devnet `tx_sig` lands and the receipt's `facilitator` field stamps
> the local URL. Pair it with the API path
> (`LEASH_API_FACILITATOR_URL=http://localhost:8787 pnpm --filter
@leash/api e2e:devnet`) for a full-stack proof.

You should see:

```
[facilitator-app] dev server on http://0.0.0.0:8787
[facilitator-app] networks: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
[facilitator-app] fee payer: HxzEv...
```

Hit `http://localhost:8787/supported` to confirm the Exact SVM scheme
is registered for both x402 v1 and v2.

## Point the demos at it

Every Leash demo (and the web playground) reads
`LEASH_FACILITATOR_URL` to override the upstream facilitator. Run any
of these against your local instance:

```bash
export LEASH_FACILITATOR_URL=http://localhost:8787
pnpm --filter @leash/buyer-demo start
pnpm --filter @leash/seller-demo start
pnpm --filter @leash/merged-demo start
```

To use the production endpoint (devnet only for v0.1):

```bash
export LEASH_FACILITATOR_URL=https://facilitator.leash.dev
```

## Production

Build the package and run the published binary directly:

```bash
pnpm --filter @leash/facilitator build
pnpm --filter @leash/facilitator-app start
```

See [`apps/docs/guides/run-a-facilitator.mdx`](../docs/guides/run-a-facilitator.mdx)
for the full deploy guide (host hardening, SOL top-ups, monitoring).
