import { NextResponse, type NextRequest } from 'next/server';

import { requirePrivySession } from '@/lib/privy-server';

/**
 * `POST /api/skills/import`
 *
 * Accepts either a GitHub repo (`owner/repo`), a full GitHub URL, or an
 * `npx skills add <repo|url>` command. Fetches the skill body from the
 * repo's `SKILL.md` (preferred) or `README.md` on `main` then `master`,
 * and returns `{ name, systemPromptFragment, sourceUrl }`.
 *
 * Pure proxy — no auth or rate-limit context is forwarded to GitHub. We
 * gate it behind a Privy session so unauthenticated traffic can't use us
 * as an open fetcher.
 */
export const runtime = 'nodejs';

const MAX_BYTES = 64 * 1024;

type Parsed = { owner: string; repo: string; subpath?: string };

function parseInput(raw: string): Parsed | null {
  const cleaned = raw.trim().replace(/^npx\s+skills\s+add\s+/i, '');
  if (!cleaned) return null;

  // Full URL form: https://github.com/<owner>/<repo>[/...]
  const urlMatch = cleaned.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(.*))?$/i);
  if (urlMatch) {
    const [, owner, repoRaw, subpath] = urlMatch;
    const repo = repoRaw!.replace(/\.git$/, '');
    return { owner: owner!, repo, subpath: subpath?.replace(/\/+$/, '') };
  }

  // owner/repo or owner/repo/sub/path
  const shortMatch = cleaned.match(/^([\w.-]+)\/([\w.-]+)(?:\/(.*))?$/);
  if (shortMatch) {
    const [, owner, repo, subpath] = shortMatch;
    return { owner: owner!, repo: repo!, subpath: subpath?.replace(/\/+$/, '') };
  }

  return null;
}

async function fetchRaw(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<{ ok: true; body: string } | { ok: false; status: number }> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'leash-agents/skills-import' },
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, status: res.status };
  const body = await res.text();
  if (body.length > MAX_BYTES) {
    return { ok: true, body: body.slice(0, MAX_BYTES) };
  }
  return { ok: true, body };
}

async function tryFetchSkill(
  owner: string,
  repo: string,
  subpath?: string,
): Promise<{ body: string; sourceUrl: string } | null> {
  const candidates: Array<{ branch: string; path: string }> = [];
  const dir = subpath ? `${subpath.replace(/\/+$/, '')}/` : '';
  for (const branch of ['main', 'master']) {
    candidates.push({ branch, path: `${dir}SKILL.md` });
    candidates.push({ branch, path: `${dir}skill.md` });
    candidates.push({ branch, path: `${dir}README.md` });
    candidates.push({ branch, path: `${dir}readme.md` });
  }
  for (const c of candidates) {
    const res = await fetchRaw(owner, repo, c.branch, c.path);
    if (res.ok) {
      return {
        body: res.body,
        sourceUrl: `https://github.com/${owner}/${repo}/blob/${c.branch}/${c.path}`,
      };
    }
  }
  return null;
}

function deriveName(repo: string, subpath: string | undefined, body: string): string {
  // Prefer the first markdown H1 in the body (after stripping front-matter)
  const stripped = body.replace(/^---[\s\S]*?---\s*/u, '');
  const h1 = stripped.match(/^#\s+(.{1,80})$/m);
  if (h1?.[1]) return h1[1].trim();
  const last = subpath?.split('/').filter(Boolean).pop();
  return last ?? repo;
}

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { input?: string } | null;
  if (!body?.input) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'input is required' },
      { status: 400 },
    );
  }
  const parsed = parseInput(body.input);
  if (!parsed) {
    return NextResponse.json(
      {
        error: 'unrecognized_format',
        message: 'Use a GitHub URL, an "owner/repo" shorthand, or "npx skills add …".',
      },
      { status: 400 },
    );
  }
  const result = await tryFetchSkill(parsed.owner, parsed.repo, parsed.subpath);
  if (!result) {
    return NextResponse.json(
      {
        error: 'not_found',
        message: `Could not find SKILL.md or README.md in ${parsed.owner}/${parsed.repo}${
          parsed.subpath ? `/${parsed.subpath}` : ''
        }.`,
      },
      { status: 404 },
    );
  }
  return NextResponse.json({
    name: deriveName(parsed.repo, parsed.subpath, result.body),
    systemPromptFragment: result.body,
    sourceUrl: result.sourceUrl,
    repo: `${parsed.owner}/${parsed.repo}`,
  });
}
