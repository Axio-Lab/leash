export type X402ClientOptions = {
  /** Called when response is 402 — return headers to merge into retry (e.g. X-PAYMENT). */
  onPaymentRequired?: (args: {
    url: string;
    response: Response;
  }) => Promise<Record<string, string>>;
};

export type X402Result = {
  request: { method: string; url: string };
  status: number;
  txSig: string | null;
  response: Response;
};

export async function x402Fetch(
  url: string,
  init: RequestInit | undefined,
  opts: X402ClientOptions,
): Promise<X402Result> {
  const method = (init?.method ?? 'GET').toUpperCase();
  let res = await fetch(url, init);
  if (res.status === 402 && opts.onPaymentRequired) {
    const headers = await opts.onPaymentRequired({ url, response: res });
    const merged = new Headers(init?.headers ?? undefined);
    for (const [k, v] of Object.entries(headers)) {
      merged.set(k, v);
    }
    res = await fetch(url, { ...init, headers: merged });
  }
  return {
    request: { method, url },
    status: res.status,
    txSig: res.headers.get('x-tx-sig'),
    response: res,
  };
}
