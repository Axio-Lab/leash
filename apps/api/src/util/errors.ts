/**
 * Typed JSON errors. Every API route returns one of these shapes when
 * something goes wrong, so polyglot SDK callers can switch on `code`
 * without having to parse human-readable strings.
 */

import type { Context } from 'hono';

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'invalid_request'
  | 'network_mismatch'
  | 'idempotency_conflict'
  | 'rpc_error'
  | 'internal';

export type ApiErrorBody = {
  error: ApiErrorCode;
  message: string;
  detail?: unknown;
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly detail?: unknown;
  constructor(args: { code: ApiErrorCode; status: number; message: string; detail?: unknown }) {
    super(args.message);
    this.code = args.code;
    this.status = args.status;
    if (args.detail !== undefined) this.detail = args.detail;
  }
}

export function jsonError(c: Context, err: ApiError): Response {
  const body: ApiErrorBody = {
    error: err.code,
    message: err.message,
    ...(err.detail !== undefined ? { detail: err.detail } : {}),
  };
  return c.json(body, err.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
}

export function unauthorized(message = 'missing or invalid api key'): ApiError {
  return new ApiError({ code: 'unauthorized', status: 401, message });
}

export function notFound(message = 'not found'): ApiError {
  return new ApiError({ code: 'not_found', status: 404, message });
}

export function invalidRequest(message: string, detail?: unknown): ApiError {
  return new ApiError({ code: 'invalid_request', status: 422, message, detail });
}

export function networkMismatch(message: string, detail?: unknown): ApiError {
  return new ApiError({ code: 'network_mismatch', status: 422, message, detail });
}

export function rateLimited(message = 'rate limit exceeded'): ApiError {
  return new ApiError({ code: 'rate_limited', status: 429, message });
}

export function rpcError(message: string, detail?: unknown): ApiError {
  return new ApiError({ code: 'rpc_error', status: 502, message, detail });
}

export function internal(message: string, detail?: unknown): ApiError {
  return new ApiError({ code: 'internal', status: 500, message, detail });
}
