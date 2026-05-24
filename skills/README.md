# Leash skills for coding agents

Drop-in skill files (Markdown with YAML frontmatter) that teach Cursor,
Claude Code, Codex, Replit, Windsurf, Continue, or any agent that
follows the `SKILL.md` convention how to build on Leash.

## Available skills

| Folder   | What it does                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leash/` | Build, monetise, and operate Solana agents that pay each other in real SPL stables via x402/MPP, including hosted payment links that forward to existing APIs after settlement. |

## Install in 30 seconds

Pick your tool — full instructions per agent live in
[`leash/INSTALL.md`](./leash/INSTALL.md).

```bash
# Cursor (project)
mkdir -p .cursor/skills && ln -sf "$(pwd)/skills/leash" .cursor/skills/leash

# Claude Code (project)
mkdir -p .claude/skills && ln -sf "$(pwd)/skills/leash" .claude/skills/leash

# Codex (project)
mkdir -p .codex/skills && ln -sf "$(pwd)/skills/leash" .codex/skills/leash

# Windsurf (project)
mkdir -p .windsurf/skills && ln -sf "$(pwd)/skills/leash" .windsurf/skills/leash
```

## What each skill ships

Every skill folder follows the same shape:

```
skills/<name>/
├── SKILL.md       Required. YAML frontmatter (`name:`, `description:`) + lean main doc (~200 lines).
├── REFERENCE.md   Optional. Full surface map — packages, routes, env vars, error codes.
├── EXAMPLES.md    Optional. Copy-paste snippets for the most common flows.
└── INSTALL.md     Optional. Per-agent install instructions (Cursor, Claude Code, Codex, …).
```

`SKILL.md` is what the agent reads first; the rest are drill-down
references it pulls in only when needed.

## Authoring a new skill

We follow the public Cursor / Anthropic convention. The two non-
negotiable rules:

1. The very first thing in `SKILL.md` is YAML frontmatter with at least
   `name:` and `description:` fields. The description is what the agent
   reads to decide whether to apply the skill — make it specific and
   include trigger terms.
2. Keep `SKILL.md` itself concise (under ~500 lines). Use
   `REFERENCE.md` / `EXAMPLES.md` for the long tail.

See [Cursor's create-skill docs](https://docs.cursor.com/agent/skills)
or any existing skill in `~/.cursor/skills-cursor/` for a worked
example.
