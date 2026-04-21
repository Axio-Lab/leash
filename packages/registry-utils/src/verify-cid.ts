import { CidMismatchError } from './errors.js';

/** After Pinata pin, confirm gateway returns 200 (CID deep-verify optional for v0.1). */
export async function verifyGatewayCid(gatewayUrl: string): Promise<void> {
  const res = await fetch(gatewayUrl);
  if (!res.ok) {
    throw new CidMismatchError(`Gateway fetch failed: ${res.status}`);
  }
}
