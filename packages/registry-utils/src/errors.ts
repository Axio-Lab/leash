export class InvalidSchemaError extends Error {
  readonly name = 'InvalidSchemaError';
}
export class PinataAuthError extends Error {
  readonly name = 'PinataAuthError';
}
export class PinataNetworkError extends Error {
  readonly name = 'PinataNetworkError';
}
export class CidMismatchError extends Error {
  readonly name = 'CidMismatchError';
}
export class FetchError extends Error {
  readonly name = 'FetchError';
}
