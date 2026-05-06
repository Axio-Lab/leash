/**
 * `@leashmarket/facilitator` — programmatic API for the Leash-operated x402
 * facilitator.
 *
 * Most deployers should run `apps/facilitator` (which thin-wraps the
 * exports below behind env vars + a Node listener). Importing this
 * package directly is useful when you want to:
 *
 *   - Mount the Hono app inside an existing service (e.g. Next.js
 *     route handler or Cloudflare Workers).
 *   - Add custom hooks (`facilitator.onAfterSettle(...)`) for
 *     analytics, on-chain mirroring, or fraud detection.
 *   - Bring your own signer wiring (e.g. an HSM-backed
 *     `FacilitatorSvmSigner`) and skip the env-driven keypair loader.
 */

export { createFacilitatorHttpServer } from './http/server.js';
export type { CreateFacilitatorHttpOptions, ProtocolFeeHealthBlock } from './http/server.js';

export { createLeashFacilitator, parseNetworksEnv, LEASH_FACILITATOR_BUILD } from './factory.js';
export type {
  CreateLeashFacilitatorOptions,
  LeashFacilitator,
  LeashNetworkSlug,
} from './factory.js';

export { buildFacilitatorSigner } from './signer.js';
export type { LeashFacilitatorSignerOptions, ResolvedFacilitatorSigner } from './signer.js';

export {
  registerLeashExactSvmScheme,
  LeashExactSvmFacilitator,
  LeashExactSvmFacilitatorV1,
} from './schemes/index.js';
export type {
  LeashExactSvmFacilitatorOptions,
  LeashExactSvmFacilitatorV1Options,
  RegisterLeashExactSvmSchemeConfig,
} from './schemes/index.js';
