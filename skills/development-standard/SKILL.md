---
name: development-standard
id: development-standard
description: Complete development standard — Git Flow, CI/CD quality gate, architecture patterns, naming, testing and secrets — with an executable profile for `praetor arch check` / `praetor standards check`.
target_agents:
  - orchestrator
  - architect
  - backend-engineer
  - frontend-engineer
  - database-engineer
  - code-reviewer
  - qa-tester
  - security-devops
  - core-engineering
required_tools:
  - read
version: "1.0"
---

# Skill: Development Standard

Umbrella standard covering every level of the development lifecycle. It points to focused skills and to the executable profile consumed by the runtime.

## Levels

1. **Git Flow** — see `skills/git-workflow/SKILL.md` (branches, PRs, commit format, execution boundaries).
2. **CI/CD quality gate** — a PR merges only if it passes: install, type-check, lint, format, unit tests, **architecture checks**, **security/secrets checks**, build.
3. **Architecture & patterns** — see `references/architecture-patterns.md`. The chosen pattern is declared in `standards/<profile>.json` and enforced by `praetor arch check`.
4. **Naming** — files `kebab-case`, classes/interfaces `PascalCase`, variables/functions `camelCase`, constants/enums `UPPER_SNAKE_CASE`, React components `PascalCase`.
5. **Typing & contracts** — see `skills/code-conventions/SKILL.md` (zero `any`, interfaces for contracts, enums for closed domains).
6. **Testing** — every functional change ships tests; error and edge cases are covered; no merge on red.
7. **Secrets** — never in code, logs or commits; configuration via environment.
8. **Logging** — no `console.*` in production; no sensitive payloads in logs.

## Executable profile

Declare `standards/<profile>.json` and reference it from `runtime.config.json`:

```json
"standards": { "profile": "default" }
```

Then:

```bash
praetor arch check [path]           # architecture + quality rules (static)
praetor standards check [path]      # arch + the profile's project commands (type-check/lint/test)
```

## Rules

- The profile is the source of truth for the workspace; keep it under version control.
- Fix violations before REVIEW; do not merge with a red gate.
- Do not duplicate `code-conventions`/`git-workflow`; this skill aggregates and points to them.
