import { RegistrationV1Schema, type RegistrationV1 } from '@leash/schemas';
import { FetchError, InvalidSchemaError } from './errors.js';

export type ResolvedRegistration = {
  uri: string;
  document: RegistrationV1;
};

export async function resolveByoUri(uri: string): Promise<ResolvedRegistration> {
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
  return { uri, document: parsed.data };
}
