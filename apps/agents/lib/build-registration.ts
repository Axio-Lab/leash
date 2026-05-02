/**
 * EIP-8004 RegistrationV1 builder for the chat product.
 *
 * Re-exports the shared implementation from `@leash/registry-utils`
 * so the chat app, the standalone `@leash/mcp` server, and the human
 * `@leash/cli` all emit the exact same on-chain `uri` shape. Keeping
 * the helper here as a re-export means existing imports
 * (`@/lib/build-registration`) continue to work unchanged.
 */

export {
  buildRegistrationV1,
  registrationToDataUrl,
  type RegistrationService,
  type RegistrationRegistrationEntry,
  type RegistrationV1,
} from '@leash/registry-utils';
