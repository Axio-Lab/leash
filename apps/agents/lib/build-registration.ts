/**
 * Build the EIP-8004 RegistrationV1 metadata document we hand to the
 * MPL Agent Registry as the agent's `uri`.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-8004#registration-v1
 *
 * Sample shape (the playground generates this exact JSON):
 * ```jsonc
 * {
 *   "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
 *   "name": "Plexpert",
 *   "description": "Onchain accountant for indie operators.",
 *   "image": "https://api.leash.market/v1/uploads/<sha256>",
 *   "services": [
 *     { "name": "web", "endpoint": "https://plexpert.xyz" },
 *     { "name": "receipts", "endpoint": "https://api.leash.market/v1/receipts/{agent}" }
 *   ],
 *   "x402Support": false,
 *   "active": true,
 *   "registrations": [],
 *   "supportedTrust": []
 * }
 * ```
 *
 * We always emit the full schema (even when fields are empty arrays)
 * because EIP-8004 consumers do `safeParse` on the document and bail
 * if the shape is partial.
 *
 * We embed the doc as a `data:application/json;…` URL so we don't need
 * a separate hosting step — the on-chain `uri` field carries the bytes
 * inline, which Metaplex + downstream resolvers accept. Hosted URLs
 * are a future optimisation (one new `image_blobs`-style endpoint).
 */

export type RegistrationService = {
  name: string;
  endpoint: string;
};

export type RegistrationRegistrationEntry = {
  agentId: string;
  agentRegistry: string;
};

export type RegistrationV1 = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';
  name: string;
  description: string;
  image: string;
  services: RegistrationService[];
  x402Support: boolean;
  active: boolean;
  registrations: RegistrationRegistrationEntry[];
  supportedTrust: string[];
};

const REGISTRATION_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1' as const;

export function buildRegistrationV1(input: {
  name: string;
  description: string;
  /** Full URL or empty string when the user skipped the image step. */
  image?: string | null;
  services?: RegistrationService[];
  /** Whether this agent answers x402 paywall flows (Leash agents do). */
  x402Support?: boolean;
  /** Marks the agent as live; defaults to `true`. */
  active?: boolean;
  registrations?: RegistrationRegistrationEntry[];
  supportedTrust?: string[];
}): RegistrationV1 {
  return {
    type: REGISTRATION_TYPE,
    name: input.name,
    description: input.description,
    image: input.image ?? '',
    services: input.services ?? [],
    x402Support: input.x402Support ?? true,
    active: input.active ?? true,
    registrations: input.registrations ?? [],
    supportedTrust: input.supportedTrust ?? [],
  };
}

/**
 * Encode a RegistrationV1 doc as a `data:application/json;utf8,<…>`
 * URL suitable for the Metaplex Agents API `uri` field. We `encodeURIComponent`
 * the JSON because data URLs reject raw `#`, `?`, and a few other chars.
 */
export function registrationToDataUrl(reg: RegistrationV1): string {
  return `data:application/json;utf8,${encodeURIComponent(JSON.stringify(reg))}`;
}
