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
   - Use conventional commit messages (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
4. **Pre-commit Gate:**
   - Before committing, run all project linters and tests to guarantee zero regressions.
