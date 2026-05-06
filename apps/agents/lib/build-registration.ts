/**
 * EIP-8004 RegistrationV1 builder for the chat product.
 *
 * Re-exports the shared implementation from `@leashmarket/registry-utils`
 * so the chat app, the standalone `@leashmarket/mcp` server, and the human
 * `@leashmarket/cli` all emit the exact same on-chain `uri` shape. Keeping
 * the helper here as a re-export means existing imports
 * (`@/lib/build-registration`) continue to work unchanged.
 */

export {
  buildRegistrationV1,
  registrationToDataUrl,
  type RegistrationService,
  type RegistrationRegistrationEntry,
  type RegistrationV1,
} from '@leashmarket/registry-utils';
