import { PinataAuthError, PinataNetworkError } from './errors.js';

export type PinJsonResult = {
  uri: string;
  cid: string;
  gatewayUrl: string;
  source: 'pinata';
};

/**
 * Pin JSON to Pinata IPFS (v3 API). Requires `PINATA_JWT`.
 * @see https://docs.pinata.cloud/
 */
export async function pinJson(
  json: unknown,
  opts?: { jwt?: string; name?: string },
): Promise<PinJsonResult> {
  const jwt = opts?.jwt ?? process.env.PINATA_JWT;
  if (!jwt) {
    throw new PinataAuthError('PINATA_JWT is required for Pinata upload');
  }
  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pinataContent: json,
      pinataMetadata: { name: opts?.name ?? 'leash-registration' },
    }),
  });
  if (!res.ok) {
    throw new PinataNetworkError(`Pinata error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { IpfsHash: string };
  const cid = data.IpfsHash;
  const gateway = process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud';
  const gatewayUrl = `${gateway}/ipfs/${cid}`;
  return { cid, uri: `ipfs://${cid}`, gatewayUrl, source: 'pinata' };
}
