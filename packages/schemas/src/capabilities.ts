import type { RegistrationV1 } from './registration.js';

export type Capability = 'buyer' | 'seller';

/**
 * Infer advertised capabilities from ERC-8004 registration JSON.
 * - Seller: any service named x402 or endpoint path suggests paid HTTP API (heuristic).
 * - Buyer: leash block with rulesUri and non-empty triggers implies outbound automation.
 */
export function inferCapabilities(doc: RegistrationV1): Capability[] {
  const caps = new Set<Capability>();
  const services = doc.services ?? [];
  for (const s of services) {
    const n = s.name.toLowerCase();
    if (n === 'x402' || n.includes('http') || s.endpoint.includes('/x402')) {
      caps.add('seller');
    }
  }
  if (doc.leash?.rulesUri) {
    caps.add('buyer');
  }
  if (caps.size === 0) {
    caps.add('buyer');
  }
  return [...caps];
}
