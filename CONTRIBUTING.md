# Contributing

## Layout

- `packages/*` — libraries (`schemas`, `core`, `registry-utils`, `seller-kit`, `buyer-kit`, `runner`, `testing`).
- `apps/*` — `web`, `docs`, `seller-demo`, `buyer-demo`, `merged-demo`.
- `scripts/` — CLI helpers (`fund-devnet`, `upload-registration`, `e2e-demo`, `gen-schema-docs.mjs`).

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

## Husky

`pnpm install` runs `prepare`, which installs Husky **only when** this directory is inside a git work tree. If you cloned only `leash/` without `.git`, hooks are skipped.

## PR checklist

- [ ] `pnpm turbo run lint typecheck test build`
- [ ] JSON Schema exports: change Zod in `@leash/schemas`, then `pnpm gen:docs` if docs should stay in sync.
