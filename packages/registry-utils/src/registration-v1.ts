/**
 * EIP-8004 RegistrationV1 metadata builder.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-8004#registration-v1
 *
 * The registration document is the off-chain JSON pointed to by the
 * MPL Core asset's `uri` field. It carries the full agent profile —
 * services list, image, x402 support flag, supported trust schemes —
 * which any wallet, indexer, or explorer can resolve and parse.
 *
 * Every Leash surface that creates an agent (chat product
 * `apps/agents`, standalone `@leash/mcp`, the human-driven `@leash/cli`)
 * builds the URI through this module so the on-chain shape stays in
 * lockstep across hosts. EIP-8004 consumers `safeParse` the document
 * and bail on partial shapes, so we always emit the full schema with
 * empty arrays where applicable.
 *
 * Sample output:
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
 *   "x402Support": true,
 *   "active": true,
 *   "registrations": [],
 *   "supportedTrust": []
 * }
 * ```
 *
 * The doc is embedded as `data:application/json;...` so we don't need
 * a separate hosting step — the on-chain `uri` carries the bytes
 * inline. Hosted URLs are a future optimisation.
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
  /** Whether this agent answers x402 paywall flows. Leash agents default to true. */
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
 * URL suitable for the MPL Agents API `uri` field. We
 * `encodeURIComponent` the JSON because data URLs reject raw `#`,
 * `?`, and a few other chars.
 */
export function registrationToDataUrl(reg: RegistrationV1): string {
  return `data:application/json;utf8,${encodeURIComponent(JSON.stringify(reg))}`;
}
