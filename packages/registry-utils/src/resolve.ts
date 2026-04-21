import { RegistrationV1Schema, type RegistrationV1 } from '@leash/schemas';
import { FetchError, InvalidSchemaError } from './errors.js';
import { pinJson, type PinJsonResult } from './pinata.js';
import { verifyGatewayCid } from './verify-cid.js';

export type ResolveOrUploadInput =
  | { uri: string; json?: never }
  | { json: RegistrationV1; uri?: never };

export type ResolveOrUploadResult = {
  uri: string;
  document: RegistrationV1;
  source: 'pinata' | 'byo';
};

export async function resolveByoUri(uri: string): Promise<ResolveOrUploadResult> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new FetchError(`Failed to fetch registration: ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new FetchError('Registration URI did not return JSON');
  }
  const parsed = RegistrationV1Schema.safeParse(body);
  if (!parsed.success) {
    throw new InvalidSchemaError(parsed.error.message);
  }
  return { uri, document: parsed.data, source: 'byo' };
}

export async function resolveOrUpload(
  input: ResolveOrUploadInput,
  opts?: { jwt?: string },
): Promise<ResolveOrUploadResult> {
  if ('uri' in input && input.uri) {
    return resolveByoUri(input.uri);
  }
  if (!('json' in input) || input.json === undefined) {
    throw new FetchError('resolveOrUpload: expected uri or json');
  }
  const document = RegistrationV1Schema.parse(input.json);
  const pinned: PinJsonResult = await pinJson(document, { jwt: opts?.jwt });
  await verifyGatewayCid(pinned.gatewayUrl);
  return {
    uri: pinned.uri,
    document,
    source: 'pinata',
  };
}
