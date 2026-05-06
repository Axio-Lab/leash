/**
 * Typed HTTP client for the Leash runner.
 *
 * The runner exposes a small REST surface (`/health`, `/pause`,
 * `/endpoints`, `/a/<mint>/receipts*`) consumed by every Leash UI surface
 * — the playground, downstream agents, CI, etc. Hand-rolling
 * `fetch(`${RUNNER}/...`)` everywhere has caused subtle bugs (URL
 * normalisation, cache headers, swallowed errors), so we expose a single
 * client that always:
 *   - sends `cache: 'no-store'`
 *   - validates response shape against `@leashmarket/schemas` where applicable
 *   - returns `null` for 404s, throws for everything else
 */

import {
  EndpointCreateInputSchema,
  EndpointV1Schema,
  ReceiptV1Schema,
  type EndpointCreateInput,
  type EndpointV1,
  type ReceiptV1,
} from '@leashmarket/schemas';

export type RunnerHealth = {
  ok: boolean;
  paused: boolean;
  source: 'env' | 'onchain' | 'cache';
};

export type RunnerPause = RunnerHealth & { env_kill: boolean };

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type RunnerClientOptions = {
  /** Base URL for the runner (e.g. `http://localhost:4040`). */
  url: string;
  /** Optional fetch override (defaults to global fetch). */
  fetch?: FetchLike;
};

export type RunnerClient = {
  url: string;
  health(): Promise<RunnerHealth>;
  pause(): Promise<RunnerPause>;
  endpoints: {
    list(filter?: { ownerAgent?: string }): Promise<EndpointV1[]>;
    get(id: string): Promise<EndpointV1 | null>;
    create(input: EndpointCreateInput): Promise<EndpointV1>;
    delete(id: string): Promise<boolean>;
  };
  receipts: {
    /** Append a receipt for the given agent. Returns the canonical hash. */
    post(receipt: ReceiptV1): Promise<string>;
    /** Fetch raw `receipts.jsonl` for the agent. */
    jsonl(mint: string): Promise<string>;
    /** Parsed receipts list (skips lines that fail to parse). */
    list(mint: string): Promise<ReceiptV1[]>;
  };
};

/**
 * Construct a {@link RunnerClient}. The client is cheap to build (no
 * network calls) so it can be created per-request in API routes without
 * caching concerns.
 */
export function createRunnerClient(opts: RunnerClientOptions): RunnerClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const base = opts.url.replace(/\/+$/, '');

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    // `cache: 'no-store'` is a Next.js / browser RequestInit extension,
    // cast so this client compiles in node-only contexts (Node 20+).
    return fetchImpl(`${base}${path}`, {
      cache: 'no-store',
      ...init,
      headers,
    } as RequestInit & { cache?: string });
  }

  async function json<T>(res: Response, label: string): Promise<T> {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`runner ${label}: non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  return {
    url: base,
    async health() {
      const res = await request('/health');
      if (!res.ok) throw new Error(`runner /health ${res.status}`);
      return json<RunnerHealth>(res, '/health');
    },
    async pause() {
      const res = await request('/pause');
      if (!res.ok) throw new Error(`runner /pause ${res.status}`);
      return json<RunnerPause>(res, '/pause');
    },
    endpoints: {
      async list(filter) {
        const params = new URLSearchParams();
        if (filter?.ownerAgent) params.set('owner_agent', filter.ownerAgent);
        const qs = params.toString();
        const res = await request(`/endpoints${qs ? `?${qs}` : ''}`);
        if (!res.ok) throw new Error(`runner /endpoints ${res.status}`);
        const body = await json<{ endpoints: unknown[] }>(res, '/endpoints');
        const out: EndpointV1[] = [];
        for (const raw of body.endpoints ?? []) {
          const parsed = EndpointV1Schema.safeParse(raw);
          if (parsed.success) out.push(parsed.data);
        }
        return out;
      },
      async get(id) {
        const res = await request(`/endpoints/${encodeURIComponent(id)}`);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`runner /endpoints/${id} ${res.status}`);
        const body = await json<unknown>(res, `/endpoints/${id}`);
        return EndpointV1Schema.parse(body);
      },
      async create(input) {
        const validated = EndpointCreateInputSchema.parse(input);
        const res = await request('/endpoints', {
          method: 'POST',
          body: JSON.stringify(validated),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`runner POST /endpoints ${res.status}: ${detail}`);
        }
        const body = await json<{ endpoint: unknown }>(res, '/endpoints');
        return EndpointV1Schema.parse(body.endpoint);
      },
      async delete(id) {
        const res = await request(`/endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.status === 204) return true;
        if (res.status === 404) return false;
        throw new Error(`runner DELETE /endpoints/${id} ${res.status}`);
      },
    },
    receipts: {
      async post(receipt) {
        const validated = ReceiptV1Schema.parse(receipt);
        const res = await request(`/a/${validated.agent}/receipts`, {
          method: 'POST',
          body: JSON.stringify(validated),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`runner POST /receipts ${res.status}: ${detail}`);
        }
        const body = await json<{ receipt_hash: string }>(res, '/receipts');
        return body.receipt_hash;
      },
      async jsonl(mint) {
        const res = await request(`/a/${encodeURIComponent(mint)}/receipts.jsonl`);
        if (!res.ok) throw new Error(`runner /a/${mint}/receipts.jsonl ${res.status}`);
        return res.text();
      },
      async list(mint) {
        const text = await this.jsonl(mint);
        const out: ReceiptV1[] = [];
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          const result = ReceiptV1Schema.safeParse(parsed);
          if (result.success) out.push(result.data);
        }
        return out;
      },
    },
  };
}
