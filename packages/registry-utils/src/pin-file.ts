import { PinataAuthError, PinataNetworkError } from './errors.js';

export type PinFileResult = {
  uri: string;
  cid: string;
  gatewayUrl: string;
  source: 'pinata';
};

export type PinFileInput = {
  /** Raw bytes / Blob / File. */
  data: Blob | ArrayBuffer | Uint8Array;
  /** Filename surfaced to Pinata (used as the pin label). */
  filename: string;
  /** MIME type. Defaults to `application/octet-stream`. */
  contentType?: string;
};

/**
 * Pin an arbitrary file (typically an image) to Pinata IPFS via the v1
 * `pinFileToIPFS` endpoint. Mirrors `pinJson` — same return shape, same
 * `PINATA_JWT` env contract.
 *
 * @see https://docs.pinata.cloud/api-reference/endpoint/v1/pinning/pin-file
 */
export async function pinFile(
  input: PinFileInput,
  opts?: { jwt?: string },
): Promise<PinFileResult> {
  const jwt = opts?.jwt ?? process.env.PINATA_JWT;
  if (!jwt) {
    throw new PinataAuthError('PINATA_JWT is required for Pinata upload');
  }

  const blob = toBlob(input.data, input.contentType ?? 'application/octet-stream');

  const form = new FormData();
  form.append('file', blob, input.filename);
  form.append('pinataMetadata', JSON.stringify({ name: input.filename }));

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    throw new PinataNetworkError(`Pinata error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { IpfsHash: string };
  const cid = data.IpfsHash;
  const gateway = process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud';
  return {
    cid,
    uri: `ipfs://${cid}`,
    gatewayUrl: `${gateway}/ipfs/${cid}`,
    source: 'pinata',
  };
}

function toBlob(data: Blob | ArrayBuffer | Uint8Array, contentType: string): Blob {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array) {
    // Copy into a fresh ArrayBuffer so Blob never sees a SharedArrayBuffer
    // view (TS strict-mode rejects the latter).
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return new Blob([copy.buffer], { type: contentType });
  }
  return new Blob([data], { type: contentType });
}
