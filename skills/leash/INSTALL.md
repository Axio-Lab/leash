# Install the Leash skill in your coding agent

The skill is a single folder (`skills/leash/`) with a YAML-frontmatter
`SKILL.md` plus reference + examples. Most modern coding agents read the
same convention; the install is just "drop the folder in the right
place" or "git clone + symlink".

## TL;DR — one command

```bash
# Clone the leash repo (or update if you already have it)
git clone https://github.com/leash-market/leash ~/leash 2>/dev/null \
  || (cd ~/leash && git pull)

# Then run ONE of the install lines below for your tool.
```

## Cursor (project skill — recommended)

Place the skill in your project so teammates inherit it:

```bash
mkdir -p .cursor/skills
ln -sf ~/leash/skills/leash .cursor/skills/leash
```

Cursor auto-discovers `.cursor/skills/*/SKILL.md`. Ask Cursor "build a
Leash agent" or "monetise this endpoint with Leash" and the skill
description triggers it.

For a personal install across all projects:

```bash
mkdir -p ~/.cursor/skills
ln -sf ~/leash/skills/leash ~/.cursor/skills/leash
```

> Do **not** put it in `~/.cursor/skills-cursor/` — that path is
> reserved for Cursor's built-in skills.

## Claude Code

Skills live in `~/.claude/skills/` (personal) or `.claude/skills/`
(project):

```bash
mkdir -p .claude/skills
ln -sf ~/leash/skills/leash .claude/skills/leash
```

Claude Code reads `SKILL.md` frontmatter to decide when to apply the
skill — same convention as Cursor.

## Codex (OpenAI)

Codex sessions read `AGENTS.md` and project skills from `.codex/skills/`:

```bash
mkdir -p .codex/skills
ln -sf ~/leash/skills/leash .codex/skills/leash
```

If your Codex setup uses `AGENTS.md` only, append:

```markdown
## Leash agent payments

Refer to `skills/leash/SKILL.md` whenever the user mentions Leash,
agent treasuries, identity profiles, verified domains, marketplace listings,
agent-created API keys, x402, MPP, hosted payment links, or per-call API
monetisation on Solana.
```

## Replit (Ghostwriter / Agent)

Replit Agent reads any `SKILL.md` files in the repo root or `skills/`.
Just commit the `skills/leash/` folder — no further config needed.

If you're working inside an existing Replit project that doesn't yet
include the leash repo, vendor the folder:

```bash
mkdir -p skills && cp -R ~/leash/skills/leash skills/leash
git add skills/leash && git commit -m "skill: vendor @leashmarket"
```

## Windsurf / Cascade

Windsurf reads `.windsurf/skills/`:

```bash
mkdir -p .windsurf/skills
ln -sf ~/leash/skills/leash .windsurf/skills/leash
```

## Continue.dev

Continue uses `.continue/rules/` for persistent context. Add a one-line
pointer:

```bash
mkdir -p .continue/rules
cat > .continue/rules/leash.md <<'EOF'
---
name: Leash
description: Use ~/leash/skills/leash/SKILL.md when the user mentions Leash, x402, MPP, hosted payment links, agent-created API keys, agent identities, verified domains, marketplace listings, agent treasuries, or Solana agent payments.
---
EOF
```

## Generic agent (any LLM tool that reads project Markdown)

Add this to your project's `AGENTS.md`, `INSTRUCTIONS.md`,
`.cursorrules`, `system-prompt.md`, or equivalent:

```markdown
## Leash skill

Whenever the user mentions Leash, leash.market, x402, MPP, hosted payment links,
agent-created API keys, agent identities, verified domains, marketplace listings,
agent treasuries, agent-to-agent payments, or per-call API monetisation on Solana, follow
the instructions in `skills/leash/SKILL.md` (with `REFERENCE.md` and
`EXAMPLES.md` as drill-down references).
```

Then make sure `skills/leash/` is committed to the repo (or available
via a path the agent can `Read`).

## Verify the install

The skill is correctly installed when your agent automatically pulls
the right context for prompts like:

- "Build a Leash agent that pays an x402 or MPP endpoint"
- "Monetise this Hono route with Leash"
- "Verify an agent domain on Leash"
- "List this trained agent on Leash marketplace"
- "Create an API key for my Leash agent"
- "How do I withdraw USDC from an agent treasury?"
- "Why is my facilitator rejecting the settle?"

If the agent doesn't pick it up, check that `SKILL.md` is at the path
its loader expects and that the YAML frontmatter (`name:` and
`description:`) is the very first thing in the file.
