---
name: git-workflow
id: git-workflow
description: Governed Git repository workflows, commit conventions, branch policies, and approval rules.
target_agents:
  - orchestrator
  - security-devops
  - code-reviewer
required_tools:
  - read
version: "1.0"
---

# Skill: Governed Git Workflow

This skill outlines safe git practices aligned with runtime security policies.

## Mandatory Invariants

1. **Force Push Forbidden:**
   - `git push --force` and `git push -f` are strictly forbidden by immutable security policy P1.
2. **Push Approval Gate:**
   - Any remote push operation requires explicit prior human confirmation.
3. **Atomic Commits:**
   - Keep commits focused on a single logical change.
   - Format: `<type>: <module>/<submodule> <description>`. Allowed types: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`, `build:`, `ci:`.
   - **No parenthesized scopes** (❌ `feat(clients): ...`, ✅ `feat: clients/search add debounce`).
4. **Pre-commit Gate:**
   - Before committing, run all project linters and tests to guarantee zero regressions.
5. **Execution Boundaries:**
   - Never run `git commit`, `git push`, or `git merge` into a protected branch (e.g. `main`/`production`, `dev`/`developer`, `release`) unless the user explicitly requests it. Local edits do not imply committing.
