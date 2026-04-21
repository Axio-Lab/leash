# @leash/runner

JSONL receipt index (in-memory `Map` in v0.1), HTTP **`/health`**, **`/pause`**, **`/a/:mint/receipts.jsonl`**, and **`leash-runner`** CLI.

Kill-switch: `LEASH_KILL=1` or mirror `LEASH_ONCHAIN_PAUSED=1` (set from your own on-chain watcher).

```bash
pnpm --filter @leash/runner start
# or
node packages/runner/dist/cli.js
```

If you see **`EADDRINUSE`** on `8787`, something else is already listening (another runner, Docker, etc.):

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN   # see PID
kill <pid>                         # stop it
# or run the runner on a different port:
PORT=8788 pnpm --filter @leash/runner start
```

If you change `PORT`, set `LEASH_RUNNER_URL` in `apps/web/.env` to match (e.g. `http://localhost:8788`).
