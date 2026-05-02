/**
 * Same-origin fetch that attaches the Privy access token when available.
 * The BFF's `requirePrivySession` accepts `Authorization: Bearer …` in
 * addition to the `privy-token` cookie.
 *
 * Always pass `getAccessToken` from `usePrivy()` — the standalone
 * `getAccessToken` import from `@privy-io/react-auth` is not guaranteed
 * to resolve the same in-flight session as the React context.
 */
export type PrivyAccessTokenGetter = () => Promise<string | null>;

export async function privyAuthedFetch(
  getAccessToken: PrivyAccessTokenGetter,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  let token: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    token = null;
  }
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(input, { ...init, credentials: 'include', headers });
}
