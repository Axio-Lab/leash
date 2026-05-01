# YC Demo Runbook

Operational playbook for recording the 60–90 second Leash agent demo
on Solana devnet. Public-facing version is at
`apps/docs/agents/demo-script.mdx`; this file is the internal
runbook with every command, env var, and recovery step.

## Status: demo-ready

- **Live integration test passes** —
  `pnpm --filter @leash/mcp test:yc-demo-devnet` runs through
  registration → identity → balance → withdrawal end-to-end against
  live devnet. Last green run: batch 5 (commit `2cd2318`).
- **All nine MCP tools wired** — see
  `packages/mcp-core/src/tools/index.ts`.
- **Three surfaces share one identity** — `@leash/mcp` (AI),
  `@leash/cli` (humans), `@leash/sdk` (apps). All read the same
  `~/.config/leash/agent.json`.

## Pre-flight checklist

1. **Workspace builds clean**

   ```bash
   pnpm install
   pnpm --filter @leash/mcp-core build
   pnpm --filter @leash/mcp build
   pnpm --filter @leash/cli build
   ```

2. **API up + reachable**

   ```bash
   curl https://api.leash.market/v1/healthz
   # OR for local: pnpm --filter @leash/api dev
   ```

3. **MCP wired into the AI host**

   ```jsonc
   // Cursor: ~/Library/Application Support/Cursor/User/settings.json
   {
     "mcpServers": {
       "leash": {
         "command": "node",
         "args": ["/abs/path/to/leash/packages/mcp/dist/cli.js"],
       },
     },
   }
   ```

4. **Devnet RPC healthy** —
   `leash-mcp doctor` should show `rpc_check: ok`.

## The recorded demo

| Beat                   | Operator prompt                                | Tool fired                     | What lands on screen                                |
| ---------------------- | ---------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| 0. Empty (set context) | "What's my Leash balance?"                     | `leash_check_treasury_balance` | `status: no_agent`, recovery hint                   |
| 1. Onboard             | "Register me a Leash agent please."            | `leash_register_agent`         | New mint, treasury, $1 USDC + 0.01 SOL, Solscan url |
| 2. Identity            | "Who am I now?"                                | `leash_get_identity`           | mint, treasury, exec pubkey, network                |
| 3. Balance             | "What's my balance?"                           | `leash_check_treasury_balance` | live SOL + USDC                                     |
| 4. Discover            | "Find me a paid OCR service under 10 cents."   | `leash_discover`               | listings (`title`, price, url)                      |
| 5. Vet                 | "What's the seller's reputation?"              | `leash_reputation`             | rating + settled_calls + dispute_rate               |
| 6. Pay                 | "Pay this link: https://leash.market/x/abc123" | `leash_pay_payment_link`       | tx_signature + receipt_hash                         |
| 7. Withdraw            | "Withdraw 50 cents USDC to <wallet>."          | `leash_withdraw_treasury`      | tx_signature + Solscan url                          |

## Recovery moves (if a beat fails on camera)

| Symptom                                           | Fix                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `register_agent` returns `error: rate_limited`    | Wait 30s, retry. Sandbox limit is 6/min/IP.                                        |
| `pay_payment_link` returns `error: wrong_network` | Confirm the link is devnet. The MCP does not pay across networks.                  |
| RPC timeouts mid-demo                             | `leash-mcp doctor` to confirm; switch `LEASH_RPC_URL` to a Helius endpoint.        |
| Agent shows wrong balance after step 6            | `leash treasury balance` from a separate terminal — RPC propagation delay (~2-3s). |

## Visuals to highlight

1. **No browser is open.** Everything happens in the AI host chat
   and the terminal.
2. **Solscan link works on every step.** Click it during step 1, 6,
   and 7 for visual proof.
3. **Cross-surface identity.** After step 1, run `leash agent show`
   in a side terminal — same mint. (Optional but powerful if you
   have screen real estate.)
4. **Real money moves.** It's devnet, but the on-chain shape is
   identical to mainnet. Receipts hash-chain, treasuries withdraw via
   `mpl-core::Execute`, the executive keypair signs every settlement.

## Reference artefacts (last verified)

- Agent mint: `AjfeyPjXm4c2C1yQjtmCygQVmARPgErweiXiokBD3yz1`
- Withdraw tx: `3okaiSTQjh5TWyrHQCz9QEPNDvtZBCb9pMcNThAvbivs7M7njGRVLZKbvSqCb37fV1cq6n1pdtkgFdg6ndSuyQHJ`
- Test that produced these: `packages/mcp/scripts/test-yc-demo-devnet.ts`
- Commit: `2cd2318` (batch 5 of agent-first MCP build)
