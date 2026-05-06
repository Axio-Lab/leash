# @leashmarket/schemas

Zod source of truth for **ReceiptV1**, **RulesV1**, **LeashBlockV1**, **RegistrationV1**, plus JSON Schema exports under `dist/schemas/` after build.

## Install

```bash
npm install @leashmarket/schemas
# or
pnpm add @leashmarket/schemas
```

## Usage

```ts
import { ReceiptV1Schema, RulesV1Schema } from '@leashmarket/schemas';

// Validate a receipt at runtime
const receipt = ReceiptV1Schema.parse(untrustedJson);
```

JSON Schema files ship at `@leashmarket/schemas/dist/schemas/*.json` for use in OpenAPI validators, JSON Schema validators, and LLM tool definitions.

## Docs

[docs.leash.market/schemas](https://docs.leash.market/schemas/receipt-v1)

## Build (monorepo)

```bash
pnpm --filter @leashmarket/schemas build
```
