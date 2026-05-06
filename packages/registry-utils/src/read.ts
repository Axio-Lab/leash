import { RegistrationV1Schema, type RegistrationV1 } from '@leashmarket/schemas';
import { FetchError, InvalidSchemaError } from './errors.js';

export async function loadRegistrationDocument(uri: string): Promise<RegistrationV1> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new FetchError(`Failed to load registration: ${res.status}`);
  }
  const body: unknown = await res.json();
  const parsed = RegistrationV1Schema.safeParse(body);
  if (!parsed.success) {
    throw new InvalidSchemaError(parsed.error.message);
  }
  return parsed.data;
}
